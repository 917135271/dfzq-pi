#!/usr/bin/env bash
set -euo pipefail

_redact() {
  printf '%s' "$1" | sed -E 's#([a-zA-Z][a-zA-Z0-9+.-]*://[^/@[:space:]]*):[^/@[:space:]]*@#\1:***@#g'
}
_log_line() {
  local level="$1" msg
  msg="$(_redact "$2")"
  printf '[%s] [%s] [init] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$level" "$msg"
}
log_info() { _log_line INFO "$1"; }
log_warn() { _log_line WARN "$1" >&2; }
log_err()  { _log_line ERR  "$1" >&2; }

die() {
  local msg="$1" anchor="${2:-}"
  if [ -n "$anchor" ]; then
    msg="${msg} → 见 deploy/README.md#${anchor}"
  fi
  log_err "$msg"
  exit 1
}

require_env() {
  local name missing=()
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      missing+=("$name")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    die "缺少必填环境变量:${missing[*]}(未设置或为空串,两者同等对待)——检查 deploy/.env" missing-env
  fi
}

DRY_RUN=0
_unknown=()
for _arg in "$@"; do
  case "$_arg" in
    --dry-run) DRY_RUN=1 ;;
    *) _unknown+=("$_arg") ;;
  esac
done
if [ "${#_unknown[@]}" -gt 0 ]; then
  die "未知参数:${_unknown[*]}(本脚本只接受 --dry-run)" unexpected-args
fi

require_env PIPELINE_DB_DSN PIPELINE_MILVUS_HOST PIPELINE_MILVUS_PORT

AUDIT_DIR="${DFZQ_AUDIT_AI_ROOT:-/app/services/audit-ai}"
VENV_PY="${DFZQ_AUDIT_AI_PYTHON:-/opt/venv/bin/python}"
SEEDS_DIR="${AUDIT_DIR}/seeds"                      # 差异 A:显式取,不用 config_dir.parent
CONFIG_DIR="${PIPELINE_CONFIG_DIR:-${AUDIT_DIR}/config}"

if [ "$DRY_RUN" = "1" ]; then
  log_info "[dry-run] 预演三段建库动作(cwd=${AUDIT_DIR}),不会真的执行、不会连接任何数据库:"
  log_info "[dry-run]   段 1/3:alembic upgrade head,随后用 ScriptDirectory.get_heads() 与 alembic_version 表逐字比对"
  log_info "[dry-run]   段 2/3:seed 字典表(seed_dicts,seeds=${SEEDS_DIR},merge upsert,重跑不产生重复行)"
  log_info "[dry-run]   段 3/3:milvus collection 形态校验/建立 + load(host=${PIPELINE_MILVUS_HOST} port=${PIPELINE_MILVUS_PORT})"
  log_info "[dry-run]   配置来源:${CONFIG_DIR}/settings.toml"
  exit 0
fi

[ -d "$AUDIT_DIR" ] || die "缺 ${AUDIT_DIR} —— 镜像里没有 audit-ai 源码?底座镜像的 COPY 层缺了" no-audit-dir
[ -x "$VENV_PY" ] || die "缺 ${VENV_PY} —— 镜像里没有 /opt/venv?底座镜像的 pip install 层缺了" no-venv
[ -f "${AUDIT_DIR}/alembic.ini" ] || die "缺 ${AUDIT_DIR}/alembic.ini" no-alembic-ini
[ -f "${CONFIG_DIR}/settings.toml" ] || die "缺 ${CONFIG_DIR}/settings.toml(PIPELINE_CONFIG_DIR=${PIPELINE_CONFIG_DIR:-<未设置,回落 ${AUDIT_DIR}/config>})" no-settings-toml
[ -d "$SEEDS_DIR" ] || die "缺 ${SEEDS_DIR} —— 段 2 的字典 CSV 在这里,底座镜像的 COPY audit-ai/seeds/ 层缺了" no-seeds-dir

log_info "配置来源:${CONFIG_DIR}/settings.toml;解释器:${VENV_PY};seeds:${SEEDS_DIR}"

_jget() {
  "$VENV_PY" -c '
import json, sys
try:
    d = json.loads(sys.argv[1])
    v = d.get(sys.argv[2])
    print("" if v is None else v)
except Exception:
    print("")
' "$1" "$2"
}

_jget_csv() {
  "$VENV_PY" -c '
import json, sys
try:
    d = json.loads(sys.argv[1])
    v = d.get(sys.argv[2]) or []
    print(",".join(str(x) for x in v))
except Exception:
    print("")
' "$1" "$2"
}

log_info "段 1/3 开始:alembic upgrade head(cwd=${AUDIT_DIR})…"
if ! (cd "$AUDIT_DIR" && "$VENV_PY" -m alembic upgrade head); then
  die "alembic upgrade head 执行失败(完整输出见上方,未被捕获/未被吞掉)——常见成因:连不上 PG(检查 PIPELINE_DB_DSN 与 pg 容器是否 healthy)、迁移历史与实际库结构冲突(revision 已推进但对应 DDL 未真正生效)、本地迁移脚本出现多个 head 分叉" alembic-upgrade-failed
fi

alembic_state="$(cd "$AUDIT_DIR" && "$VENV_PY" - <<'ALEMBICPY'
import json
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.exc import ProgrammingError
from pipeline.config import load_config


def main():
    cfg = load_config()
    alcfg = Config("alembic.ini")
    script = ScriptDirectory.from_config(alcfg)
    heads = sorted(script.get_heads())

    engine = create_engine(cfg.db.dsn)
    try:
        with engine.connect() as conn:
            try:
                rows = conn.execute(text("SELECT version_num FROM alembic_version")).fetchall()
                current = sorted(r[0] for r in rows)
            except ProgrammingError:
                current = []  # alembic_version 表不存在 = 数据库从未跑过迁移
    finally:
        engine.dispose()

    return {"ok": 1, "heads": heads, "current": current, "at_head": current == heads}


try:
    out = main()
except Exception as e:
    out = {"ok": 0, "reason": "unexpected", "err": f"{type(e).__name__}: {e}"}
print(json.dumps(out))
ALEMBICPY
)"

alembic_ok="$(_jget "$alembic_state" ok)"
if [ "$alembic_ok" != "1" ]; then
  alembic_err="$(_jget "$alembic_state" err)"
  die "段 1:alembic 迁移状态校验失败:${alembic_err:-未知原因}" alembic-io-error
fi
at_head="$(_jget "$alembic_state" at_head)"
if [ "$at_head" != "True" ]; then
  heads_csv="$(_jget_csv "$alembic_state" heads)"
  current_csv="$(_jget_csv "$alembic_state" current)"
  die "段 1:alembic upgrade head 执行完毕,但数据库实际落地的 revision(${current_csv:-空})与迁移脚本算出的 head(${heads_csv:-空})不一致——迁移没有真的生效" alembic-not-at-head
fi
current_csv="$(_jget_csv "$alembic_state" current)"
log_info "段 1/3 完成:alembic 已在 head(${current_csv});task_runs 表由 alembic/versions/0017_task_runtime_history.py 建,已被这一段覆盖,不需要独立建表步骤"

log_info "段 2/3 开始:seed 字典表(seeds=${SEEDS_DIR})…"
if ! seed_out="$(cd "$AUDIT_DIR" && "$VENV_PY" - "$SEEDS_DIR" <<'SEEDPY'
import json, sys
from sqlalchemy import text
from pipeline.config import load_config
from pipeline.index.pg_io import PgIO

TABLES = ("dict_biz_domains", "dict_entity_types", "dict_aliases")


def counts(pio):
    out = {}
    with pio.engine.connect() as conn:
        for t in TABLES:
            out[t] = conn.execute(text(f"SELECT count(*) FROM {t}")).scalar()
    return out


def main():
    seeds_dir = sys.argv[1]
    cfg = load_config()
    pio = PgIO.from_config(cfg)
    try:
        before = counts(pio)
        imported = pio.seed_dicts(seeds_dir)
        after = counts(pio)
    finally:
        pio.engine.dispose()
    empty = [t for t, n in after.items() if not n]
    return {
        "ok": 0 if empty else 1,
        "reason": "empty_tables" if empty else "",
        "empty": empty,
        "imported": imported,
        "before": before,
        "after": after,
    }


try:
    out = main()
except Exception as e:
    out = {"ok": 0, "reason": "unexpected", "err": f"{type(e).__name__}: {e}"}
print(json.dumps(out))
SEEDPY
)"; then
  die "段 2:seed 字典表的子进程异常退出(完整输出见上方)" seed-failed
fi

seed_ok="$(_jget "$seed_out" ok)"
if [ "$seed_ok" != "1" ]; then
  seed_reason="$(_jget "$seed_out" reason)"
  case "$seed_reason" in
    empty_tables)
      die "段 2:seed 之后字典表仍然是 0 行(${seed_out})——检查 ${SEEDS_DIR} 下的 CSV 是不是空的,或 seed_dicts() 写进了另一个库" seed-empty
      ;;
    *)
      seed_err="$(_jget "$seed_out" err)"
      die "段 2:seed 字典表失败:${seed_err:-未知原因}" seed-failed
      ;;
  esac
fi
log_info "段 2/3 完成:字典已 seed(merge upsert,重跑不产生重复行)。明细(CSV 读入行数 / seed 前后表行数):${seed_out}"

log_info "段 3/3 开始:milvus collection 形态校验/建立 + load(host=${PIPELINE_MILVUS_HOST} port=${PIPELINE_MILVUS_PORT})…"
milvus_out="$(cd "$AUDIT_DIR" && "$VENV_PY" - "$PIPELINE_MILVUS_PORT" <<'MILVUSPY'
import json, sys
from pymilvus import Collection, utility
from pipeline.config import load_config
from pipeline.index.milvus_io import MilvusIO

DENSE_DIM = 1024


def main():
    env_port = sys.argv[1]
    cfg = load_config()
    if str(cfg.milvus.port) != str(env_port):
        return {
            "ok": 0, "reason": "port_mismatch",
            "cfg_port": cfg.milvus.port, "env_port": env_port,
            "config_dir": str(cfg.config_dir),
        }

    mio = MilvusIO(cfg)
    mio.connect()
    try:
        want_bm25 = cfg.embedding.sparse_backend == "bm25"
        name = cfg.milvus.collection
        if utility.has_collection(name):
            col = Collection(name)
            fields = {f.name: f for f in col.schema.fields}
            dim = fields["dense_vec"].params.get("dim")
            is_pk = bool(getattr(fields["corpus_type"], "is_partition_key", False))
            has_analyzer = bool(fields["text"].params.get("enable_analyzer"))
            if dim != DENSE_DIM:
                return {"ok": 0, "reason": "dim_mismatch", "dim": dim,
                        "sparse_backend": cfg.embedding.sparse_backend}
            if not is_pk:
                return {"ok": 0, "reason": "not_partition_key",
                        "sparse_backend": cfg.embedding.sparse_backend}
            if has_analyzer != want_bm25:
                return {
                    "ok": 0, "reason": "sparse_backend_mismatch",
                    "has_analyzer": int(has_analyzer), "want_bm25": int(want_bm25),
                    "sparse_backend": cfg.embedding.sparse_backend,
                }
            col.load()
            action = "reused"
        else:
            mio.create_collection()  # 内部已对新建的 collection 调过 col.load(),不重复
            action = "created"
        return {
            "ok": 1, "action": action, "collection": name,
            "sparse_backend": cfg.embedding.sparse_backend,
            "config_dir": str(cfg.config_dir),
        }
    finally:
        mio.disconnect()


try:
    out = main()
except Exception as e:
    out = {"ok": 0, "reason": "unexpected", "err": f"{type(e).__name__}: {e}"}
print(json.dumps(out))
MILVUSPY
)"

ok="$(_jget "$milvus_out" ok)"
if [ "$ok" != "1" ]; then
  reason="$(_jget "$milvus_out" reason)"
  case "$reason" in
    port_mismatch)
      cfg_port="$(_jget "$milvus_out" cfg_port)"
      cfg_dir="$(_jget "$milvus_out" config_dir)"
      die "段 3:PIPELINE_MILVUS_PORT=${PIPELINE_MILVUS_PORT} 与 ${cfg_dir:-$CONFIG_DIR}/settings.toml 的 [milvus].port=${cfg_port} 不一致 —— pipeline.config._apply_env **不支持**用环境变量覆盖 milvus.port(只支持 PIPELINE_MILVUS_HOST 覆盖 host),这个环境变量本身不会改变实际连接端口。必须让两者一致:容器网络内固定用 19530(compose.yml 的 pi.environment 已经这么设),若这里读到别的值,是 deploy/.env 的 PIPELINE_MILVUS_PORT 被改过" milvus-port-mismatch
      ;;
    dim_mismatch|not_partition_key|sparse_backend_mismatch)
      has_analyzer="$(_jget "$milvus_out" has_analyzer)"
      dim="$(_jget "$milvus_out" dim)"
      sparse_backend="$(_jget "$milvus_out" sparse_backend)"
      die "段 3:既有 collection 的形态与当前配置不符(reason=${reason}, dense_vec.dim=${dim:-?}, text.enable_analyzer=${has_analyzer:-?}, sparse_backend=${sparse_backend:-?})—— 拒绝静默复用一个形态不对的 collection。修法需人显式确认:drop 重建会**清空该 collection 的全部向量、语料要全量重灌**(MilvusIO(cfg).create_collection(drop_existing=True)),本脚本不会自动做" milvus-schema-mismatch
      ;;
    *)
      err="$(_jget "$milvus_out" err)"
      die "段 3:Milvus 建库/校验失败:${err:-未知原因}" milvus-io-error
      ;;
  esac
fi

action="$(_jget "$milvus_out" action)"
collection_name="$(_jget "$milvus_out" collection)"
sparse_backend="$(_jget "$milvus_out" sparse_backend)"
case "$action" in
  reused)  log_info "段 3/3 完成:collection ${collection_name} 已存在且形态与 sparse_backend=${sparse_backend} 一致,已 load" ;;
  created) log_info "段 3/3 完成:collection ${collection_name} 不存在,已按 sparse_backend=${sparse_backend} 建立并 load" ;;
  *)       log_info "段 3/3 完成:collection ${collection_name} 已就绪(action=${action}, sparse_backend=${sparse_backend})" ;;
esac
log_info "init.sh 完成:alembic 在 head(${current_csv})/ 字典已 seed / collection ${collection_name} 已就绪(sparse_backend=${sparse_backend})"
