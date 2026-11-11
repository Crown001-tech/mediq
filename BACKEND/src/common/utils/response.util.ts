import { Response } from 'express';

export function sendSuccess<T>(
  res: Response,
  data?: T,
  message?: string,
  statusCode: number = 200,
  extra: Record<string, any> = {}
) {
  return res.status(statusCode).json({
    success: true,
    ...(message ? { message } : {}),
    ...(data !== undefined ? (typeof data === 'object' && !Array.isArray(data) ? data : { data }) : {}),
    ...extra,
  });
}

export function sendError(
  res: Response,
  error: string = 'An unexpected error occurred',
  statusCode: number = 500,
  details?: any
) {
  return res.status(statusCode).json({
    success: false,
    error,
    ...(details ? { details } : {}),
  });
}
