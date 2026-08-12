import { AuthUser } from '../modules/auth/auth.repository';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
