import { ServiceUnavailableException } from '@nestjs/common';

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ServiceUnavailableException(`${name} is not configured`);
  }
  return value;
}

export function envFirst(names: string[], label: string): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new ServiceUnavailableException(`${label} is not configured`);
}

export function webOrigin(): string {
  return (process.env.WEB_ORIGIN?.trim() || 'https://localhost:5173').replace(/\/$/, '');
}
