import express from 'express';
import authRoute from './auth.route';
import userRoute from './user.route';
import fileUploadRoute from './fileUpload.route';
import healthRouter from './health.route';
import productRoute from '../modules/products/product.route';
import storeRoute from '../modules/stores/store.route';
import merchantAdsRoute from '../modules/merchantAds/merchantAds.route';
import categoryRoute from '../modules/categories/category.route';
import orderRoute from '../modules/orders/order.route';
import inventoryRoutes from './inventory.route';
import cartRoutes from '../modules/cart/cart.route';
import paymentRoute from '../modules/payments/payment.route';
import supplierProductsRoute from '../modules/supplierProducts/supplierProducts.route';
import shipmentRoute from '../modules/shipments/shipment.route';
import returnRoute from '../modules/returns/return.route';
import settlementRoute from '../modules/settlements/settlement.route';
import payoutRoute from '../modules/payouts/payout.route';
import rbacRoute from './rbac.route';
import agentRoute from './agent.route';
import {
  publicAppReleaseRouter,
  adminAppReleaseRouter,
} from '../modules/appRelease/app-release.route';

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
router.use('/v1/supplier-products', supplierProductsRoute);
router.use('/v1/stores', storeRoute);
router.use('/v1/merchant-ads', merchantAdsRoute);
router.use('/health', healthRouter);
router.use('/v1/categories', categoryRoute);
router.use('/v1/orders', orderRoute);
router.use('/v1/inventory', inventoryRoutes);
router.use('/v1/cart', cartRoutes);
router.use('/v1/payments', paymentRoute);
router.use('/v1/shipments', shipmentRoute);
router.use('/v1/returns', returnRoute);
router.use('/v1/settlements', settlementRoute);
router.use('/v1/payouts', payoutRoute);
router.use('/v1/rbac', rbacRoute);
router.use('/v1/agent', agentRoute);
router.use('/v1/app', publicAppReleaseRouter);
router.use('/v1/admin/app-releases', adminAppReleaseRouter);

export default router;
