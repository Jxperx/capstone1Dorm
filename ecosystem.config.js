module.exports = {
  apps: [
    {
      name: 'boarding-house',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      combine_logs: true,
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
