import express from 'express';
import authRoute from './modules/auth/auth.route';
import userRoute from './modules/users/user.route';
import fileUploadRoute from './modules/fileUpload/fileUpload.route';
import healthRouter from './modules/health/health.route';
import productRoute from './modules/products/product.route';
import storeRoute from './modules/stores/store.route';
import merchantAdsRoute from './modules/merchantAds/merchantAds.route';
import categoryRoute from './modules/categories/category.route';
import orderRoute from './modules/orders/order.route';
import inventoryRoutes from './modules/inventory/inventory.route';
import cartRoutes from './modules/cart/cart.route';
import paymentRoute from './modules/payments/payment.route';
import supplierProductsRoute from './modules/supplierProducts/supplierProducts.route';
import returnRoute from './modules/returns/return.route';
import settlementRoute from './modules/settlements/settlement.route';
import payoutRoute from './modules/payouts/payout.route';
import rbacRoute from './modules/rbac/rbac.route';
import adminApprovalRoute from './modules/adminApprovals/adminApproval.route';
import agentRoute from './modules/agent/agent.route';
import propertyRoute from './modules/properties/property.route';
import {
  publicAppReleaseRouter,
  adminAppReleaseRouter,
} from './modules/appRelease/app-release.route';
import filesRoute from './modules/files/files.route';
import analyticsRoute from './modules/analytics/analytics.route';
import pricingRoute from './modules/pricing/pricing.route';
import reviewRoute from './modules/reviews/review.route';
import wishlistRoute from './modules/wishlists/wishlist.route';
import notificationRoute from './modules/notifications/notification.route';

const router = express.Router();

router.get('/v1', (_, res) => {
  res.json({
    message: 'Welcome to mapanytime-api',
  });
});

router.use('/v1/auth', authRoute);
router.use('/v1/users', userRoute);
router.use('/v1/file-uploads', fileUploadRoute);
router.use('/v1/files', filesRoute);
router.use('/v1/products', productRoute);
router.use('/v1/supplier-products', supplierProductsRoute);
router.use('/v1/stores', storeRoute);
router.use('/v1/merchant-ads', merchantAdsRoute);
router.use('/v1/pricing', pricingRoute);
router.use('/health', healthRouter);
router.use('/v1/categories', categoryRoute);
router.use('/v1/orders', orderRoute);
router.use('/v1/inventory', inventoryRoutes);
router.use('/v1/cart', cartRoutes);
router.use('/v1/payments', paymentRoute);
router.use('/v1/returns', returnRoute);
router.use('/v1/settlements', settlementRoute);
router.use('/v1/payouts', payoutRoute);
router.use('/v1/rbac', rbacRoute);
router.use('/v1/agent', agentRoute);
router.use('/v1/app', publicAppReleaseRouter);
router.use('/v1/admin/app-releases', adminAppReleaseRouter);
router.use('/v1/admin/approvals', adminApprovalRoute);
router.use('/v1/properties', propertyRoute);
router.use('/v1/analytics', analyticsRoute);
router.use('/v1/reviews', reviewRoute);
router.use('/v1/wishlist', wishlistRoute);
router.use('/v1/notifications', notificationRoute);

export default router;
