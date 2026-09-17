module.exports = {
  apps: [
    {
      name: 'yuanqing-ai',
      script: 'node',
      args: 'dist/server.js',
      cwd: '/home/user/webapp',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
        DB_HOST: '127.0.0.1',
        DB_PORT: 3306,
        DB_USER: 'yuanqing',
        DB_PASS: 'yuanqing123',
        DB_NAME: 'yuanqing'
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
