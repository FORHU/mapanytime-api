import express from 'express';
import authRoute from './auth.route';
import userRoute from './user.route';
import fileUploadRoute from './fileUpload.route';
import healthRouter from './health.route';
import productRoute from './product.route';
import storeRoute from './store.route';
import categoryRoute from './category.route';

const router = express.Router();

router.get('/v1', (_, res) => {
  res.json({
    message: 'Welcome to mapanytime-api',
  });
});

router.use('/v1/auth', authRoute);
router.use('/v1/users', userRoute);
router.use('/v1/file-uploads', fileUploadRoute);
router.use('/v1/products', productRoute);
router.use('/v1/stores', storeRoute);
router.use('/health', healthRouter);
router.use('/v1/categories', categoryRoute);

export default router;
