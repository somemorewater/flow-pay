import { api, setToken } from './client';
import type { User } from '@/types';

interface AuthPayload {
  user: User;
  token: string;
}

export async function register(email: string, password: string): Promise<AuthPayload> {
  const data = await api.post<AuthPayload>('/auth/register', { email, password }, { auth: false });
  setToken(data.token);
  return data;
}

export async function login(email: string, password: string): Promise<AuthPayload> {
  const data = await api.post<AuthPayload>('/auth/login', { email, password }, { auth: false });
  setToken(data.token);
  return data;
}

export function logout() {
  setToken(null);
}

export async function getCurrentUser(): Promise<User> {
  const data = await api.get<{ user: User }>('/auth/me');
  return data.user;
}
