// 本地开发（沙箱）用：后端 :8080、前端静态 :3000（vite preview，/api 反代到后端）
module.exports = {
  apps: [
    {
      name: 'cloudwatch-api',
      cwd: '/home/user/webapp/backend',
      script: './bin/cloudwatch-api',
      env: {
        CW_ADDR: ':8080',
        CW_DB_DSN: 'cw:cwpass@tcp(127.0.0.1:3306)/cloudwatch',
        CW_SECRET_KEY: 'local-dev-secret-key-123456',
        CW_ADMIN_PASSWORD: 'LocalDev#2026',
      },
    },
    {
      name: 'cloudwatch-web',
      cwd: '/home/user/webapp/frontend',
      script: 'npx',
      args: 'vite preview --host 0.0.0.0 --port 3000',
    },
  ],
};
