import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import apiRouter from './routes/index.js';
import { errorHandler, notFoundHandler } from './common/middleware/error.middleware.js';

export function createApp(): Express {
  const app = express();

  // CORS configuration
  const allowedOrigins = [
    env.CORS_ORIGIN,
    env.FRONTEND_URL,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ].filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, or server-to-server)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
          return callback(null, true);
        }
        return callback(null, true); // Dev-friendly permissive CORS
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie'],
    })
  );

  // Body Parsing Middlewares
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Root Welcome & Health Info
  app.get('/', (req: Request, res: Response) => {
    res.json({
      name: 'MedIQ Backend API Server',
      architecture: 'Modular Monolith (MVC)',
      version: '1.0.0',
      status: 'online',
      endpoints: {
        health: '/api/v1/health',
        apiV1: '/api/v1',
        legacyApi: '/api',
      },
    });
  });

  // Mount API Routers:
  // Both /api/v1 and /api routes are mounted to ensure full backwards compatibility
  app.use('/api/v1', apiRouter);
  app.use('/api', apiRouter);

  // 404 Not Found Handler
  app.use(notFoundHandler);

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
