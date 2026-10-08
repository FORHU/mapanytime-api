import express, { RequestHandler } from 'express';
import AuthController from './auth.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { upload } from '../../middleware/upload.middleware';

const router = express.Router();

/**
 * The buyer's valid ID photo on sign-up. Multer's own errors (too large, file
 * type not allowed) are the client's fault, so they surface as 400 rather than
 * reaching the error handler as a 500.
 */
const validIdUpload: RequestHandler = (req, res, next) =>
  upload.single('validId')(req, res, (err?: unknown) =>
    err ? next({ status: 400, message: (err as Error).message }) : next(),
  );

// Multipart when the app attaches a buyer's valid ID photo (`validId`); multer
// passes the web's plain JSON sign-up through untouched.
router.post('/register', validIdUpload, AuthController.register);
router.post('/login', AuthController.login);
// Both verify their token server-side before trusting any identity from it — googleLogin
// against Google's public keys, facebookLogin against the Graph API — unlike the old
// googleLogin handler this replaced, which trusted a client-supplied email outright.
router.post('/google', AuthController.googleLogin);
router.post('/facebook', AuthController.facebookLogin);
// The Flutter client has shipped against both of these since before they
// existed; a locked-out user had two screens and no endpoint. See FLAGS.md ID-6.
router.post('/forgot-password', AuthController.forgotPassword);
router.post('/reset-password', AuthController.resetPassword);
router.post('/refresh-token', AuthController.refreshToken);
router.post('/logout', authenticate, AuthController.logout);

export default router;
