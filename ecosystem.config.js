// PM2 Ecosystem — LyraCore Backend
// Usage:  pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'lyracore-backend',
      script: 'dist/index.js',
      cwd: '/var/www/lyracore/backend',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
    },
  ],
};
