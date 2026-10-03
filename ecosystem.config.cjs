// 本地开发（沙箱）用：后端 :8080、前端静态 :3000（vite preview，/api 反代到后端）
module.exports = {
  apps: [
    {
      name: 'icloud99-api',
      cwd: '/home/user/webapp/backend',
      script: './bin/icloud99-api',
      env: {
        ICLOUD99_ADDR: ':8080',
        ICLOUD99_DB_DSN: 'cw:cwpass@tcp(127.0.0.1:3306)/icloud99',
        ICLOUD99_SECRET_KEY: 'local-dev-secret-key-123456',
        ICLOUD99_ADMIN_PASSWORD: 'LocalDev#2026',
      },
    },
    {
      name: 'icloud99-web',
      cwd: '/home/user/webapp/frontend',
      script: 'npx',
      args: 'vite preview --host 0.0.0.0 --port 3000',
    },
  ],
};
