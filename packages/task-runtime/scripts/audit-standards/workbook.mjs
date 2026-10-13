import * as XLSX from '@e965/xlsx';

const columns = ['审计规范', '大类', '分项', '审计事项(底稿名称)', '审计步骤(稽核要点及程序)', '审计目标', '审计依据', '审计事项序号'];
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const bytes = Buffer.concat(chunks);
if (bytes.length > 50 * 1024 * 1024) throw new Error('文件超过 50 MB');
const mode = process.argv[2];
if (mode === 'read') {
  const workbook = XLSX.read(bytes, { type: 'buffer', cellFormula: true });
  if (workbook.SheetNames.length !== 1) throw new Error('规范文件须包含一张规范表');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  if (range.e.r > 2000 || range.e.c !== 7) throw new Error('规范须为模板八列，最多 2000 个事项');
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  const normalize = value => String(value).replace(/\s/g, '').replace(/（/g, '(').replace(/）/g, ')');
  if (columns.some((column, i) => normalize(matrix[0]?.[i]) !== normalize(column))) throw new Error('规范表头或字段顺序与模板不一致');
  for (const key of Object.keys(sheet)) if (!key.startsWith('!') && sheet[key]?.f) throw new Error('规范成品不能包含公式');
  for (const merge of sheet['!merges'] || []) {
    if (merge.s.r > 0 && merge.s.c === merge.e.c && merge.s.c < 3) {
      const value = matrix[merge.s.r]?.[merge.s.c] || '';
      for (let i = merge.s.r + 1; i <= merge.e.r; i++) if (matrix[i]) matrix[i][merge.s.c] = value;
    }
  }
  const rows = matrix.slice(1).filter(row => row.some(value => String(value).trim())).map(row =>
    Object.fromEntries(columns.map((column, i) => [column, String(row[i] ?? '')])));
  process.stdout.write(JSON.stringify(rows));
} else if (mode === 'write') {
  const rows = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(rows) || !rows.length || rows.length > 2000) throw new Error('规范内容为空或超过 2000 个事项');
  const sheet = XLSX.utils.aoa_to_sheet([columns, ...rows.map(row => columns.map(column => String(row[column] ?? '')))]);
  sheet['!cols'] = [30, 24, 28, 30, 100, 40, 60, 14].map(wch => ({ wch }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '审计规范');
  process.stdout.write(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
} else throw new Error('仅支持 read 或 write');
