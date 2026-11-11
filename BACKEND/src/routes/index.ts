import { Router } from 'express';
import appointmentsRouter from '../modules/appointments/appointments.routes.js';
import notificationsRouter from '../modules/notifications/notifications.routes.js';
import enrollmentsRouter from '../modules/enrollments/enrollments.routes.js';
import adminRouter from '../modules/admin/admin.routes.js';
import casesRouter from '../modules/cases/cases.routes.js';
import carePlansRouter from '../modules/care-plans/care-plans.routes.js';
import identityRouter from '../modules/identity/identity.routes.js';

const apiRouter = Router();

// Health Check
apiRouter.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'mediq-backend-modular-monolith',
  });
});

// Domain Feature Modules
apiRouter.use('/appointments', appointmentsRouter);
apiRouter.use('/notifications', notificationsRouter);
apiRouter.use('/enrollments', enrollmentsRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/cases', casesRouter);
apiRouter.use('/care-plans', carePlansRouter);
apiRouter.use('/identity', identityRouter);

export default apiRouter;
