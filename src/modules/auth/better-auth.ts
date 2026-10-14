import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { bearer } from 'better-auth/plugins';
import { prisma } from '../../utils/prisma';

// SPIKE (#122): proves tsc, the built server and Jest can all load Better Auth
// from this CommonJS codebase. Not wired into the app yet.
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true },
  plugins: [bearer()],
});
