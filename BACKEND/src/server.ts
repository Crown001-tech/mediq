import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();
const PORT = env.PORT || 5001;

const server = app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 MedIQ Backend (Modular Monolith MVC) is running!`);
  console.log(`📍 Listening on: http://localhost:${PORT}`);
  console.log(`🌐 Environment:  ${env.NODE_ENV}`);
  console.log(`📡 API Base:     http://localhost:${PORT}/api/v1`);
  console.log(`🔗 Legacy Base:  http://localhost:${PORT}/api`);
  console.log(`🏥 Health Check: http://localhost:${PORT}/api/v1/health`);
  console.log(`======================================================\n`);
});

// Graceful Shutdown
function handleShutdown(signal: string) {
  console.log(`\nReceived ${signal}. Gracefully shutting down MedIQ backend...`);
  server.close(() => {
    console.log('HTTP server closed. Exiting process.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forcefully terminating process after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
