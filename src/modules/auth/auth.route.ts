import express from 'express';
import AuthController from './auth.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

router.post('/register', AuthController.register);
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
