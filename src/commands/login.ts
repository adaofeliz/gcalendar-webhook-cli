import { login } from '../auth/googleAuth';

export const loginCommand = async (): Promise<void> => {
  await login();
};
