import express from 'express';
import AuthController from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = express.Router();

router.post('/register', AuthController.register);
router.post('/login', AuthController.login);
// DISABLED — AuthController.googleLogin trusts a client-supplied email and issues tokens for it,
// which is an unauthenticated account takeover. Do not register this route until the controller
// verifies a real Google ID token. See the SECURITY note on AuthController.googleLogin.
// router.post('/google', AuthController.googleLogin);
router.post('/refresh-token', AuthController.refreshToken);
router.post('/logout', authenticate, AuthController.logout);

export default router;
