export interface RequestUser {
  id: string;
  loginUsername: string;
  isAdmin?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: RequestUser;
      id?: string;
    }
  }
}
