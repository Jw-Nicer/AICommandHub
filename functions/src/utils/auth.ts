import { getAuth } from 'firebase-admin/auth';

export interface DecodedUser {
  uid: string;
  email?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function verifyAuth(req: any, res: any): Promise<DecodedUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid Authorization header' });
    return null;
  }

  try {
    const token = authHeader.replace('Bearer ', '');
    const decoded = await getAuth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email };
  } catch {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function requireMethod(req: any, res: any, method: string): boolean {
  if (req.method !== method) {
    res.status(405).json({ error: 'method_not_allowed', message: `Expected ${method}` });
    return false;
  }
  return true;
}
