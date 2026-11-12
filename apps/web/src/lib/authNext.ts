/** Destinos internos permitidos após autenticação. */
export function authNext(value: string | null): '/invite' | '/communities' | '/' {
  return value === '/invite' || value === '/communities' ? value : '/';
}
