import { AuthUser } from '../repositories/auth.repository';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
