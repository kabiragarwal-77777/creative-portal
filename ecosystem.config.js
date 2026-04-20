'use strict';

module.exports = {
  apps: [
    {
      name: 'portal-uploader',
      script: './uploader/server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_file: './uploader/.env',
      error_file: './logs/uploader-error.log',
      out_file: './logs/uploader-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: 'portal-intelligence',
      script: './intelligence/server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT_INTEL: 3008
      },
      env_file: './.env',
      error_file: './logs/intelligence-error.log',
      out_file: './logs/intelligence-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: 'portal-inventory-scanner',
      script: './inventory-scanner/server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3002
      },
      env_file: './inventory-scanner/.env',
      error_file: './logs/scanner-error.log',
      out_file: './logs/scanner-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: 'portal-google-creative',
      script: './google-creative/standalone-server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3003
      },
      env_file: './.env',
      error_file: './logs/google-creative-error.log',
      out_file: './logs/google-creative-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: 'portal-audience-testing',
      script: './audience-testing/standalone-server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3004
      },
      env_file: './.env',
      error_file: './logs/audience-error.log',
      out_file: './logs/audience-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: 'portal-feedback-engine',
      script: './feedback-engine/standalone-server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3005
      },
      env_file: './.env',
      error_file: './logs/feedback-error.log',
      out_file: './logs/feedback-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: 'portal-trend-scanner',
      script: './trend-scanner/server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        PORT: 3006
      },
      env_file: './.env',
      error_file: './logs/trends-error.log',
      out_file: './logs/trends-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: 'portal-creative-intelligence',
      script: './creative-intelligence/server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3007
      },
      env_file: './.env',
      error_file: './logs/ci-error.log',
      out_file: './logs/ci-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};
