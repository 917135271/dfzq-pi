// Product code comes exclusively from main. This branch adds operations only.
pipeline {
    agent any
    options {
        timeout(time: 60, unit: 'MINUTES')
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '30'))
    }
    stages {
        stage('Main parity') { steps { sh 'bash ci/check-main.sh' } }
        stage('Build and offline tests') { steps { sh 'bash ci/build.sh' } }
        stage('Infrastructure rehearsal') { steps { sh 'bash ci/rehearse.sh' } }
        stage('Publish') {
            when { expression {
                def b = env.BRANCH_NAME ?: env.GIT_BRANCH ?: ''
                return !env.CHANGE_ID && (b in ['dfzq/intranet', 'origin/dfzq/intranet', 'refs/heads/dfzq/intranet', 'refs/remotes/origin/dfzq/intranet'])
            } }
            steps { sh 'bash ci/publish.sh' }
        }
        stage('Deploy') {
            when { expression {
                def b = env.BRANCH_NAME ?: env.GIT_BRANCH ?: ''
                return !env.CHANGE_ID && env.DFZQ_NO_PROD_DEPLOY != '1' && (b in ['dfzq/intranet', 'origin/dfzq/intranet', 'refs/heads/dfzq/intranet', 'refs/remotes/origin/dfzq/intranet'])
            } }
            steps {
                withCredentials([sshUserPrivateKey(credentialsId: 'dfzq-build-ssh', keyFileVariable: 'SSH_KEY')]) {
                    sh 'bash ci/deploy.sh'
                }
            }
        }
    }
    post {
        always {
            sh 'bash ci/rehearsal-down.sh'
            archiveArtifacts artifacts: 'ci/out/junit-*.xml', allowEmptyArchive: true
            script {
                if (fileExists('ci/out/junit-node.xml')) {
                    junit testResults: 'ci/out/junit-*.xml', allowEmptyResults: false
                }
            }
        }
    }
}
