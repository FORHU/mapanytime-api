import express from 'express';
import ReviewController from './review.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

// Reading is public — ratings are what a browsing buyer weighs a product by.
// Writing requires a completed order for the thing being reviewed; see
// ReviewService. Closes FLAGS.md CAT-6 and STO-6.
router.get('/products/:productId', ReviewController.listProductReviews);
router.get('/stores/:storeId', ReviewController.listStoreReviews);

router.get('/me', authenticate, ReviewController.myReviews);

router.put('/products/:productId', authenticate, ReviewController.upsertProductReview);
router.delete('/products/reviews/:reviewId', authenticate, ReviewController.deleteProductReview);

router.put('/stores/:storeId', authenticate, ReviewController.upsertStoreReview);
router.delete('/stores/reviews/:reviewId', authenticate, ReviewController.deleteStoreReview);

export default router;
