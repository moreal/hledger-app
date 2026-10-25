import { LedgerTransportError } from '../../packages/client';

/** Connection attempts are transactional: a failed candidate never replaces the active client. */
export function failedConnectionMessage(cause: unknown, hasVerifiedConnection: boolean): string {
  const reason =
    cause instanceof LedgerTransportError && cause.kind === 'network'
      ? '서버에 연결하지 못했습니다. 주소와 네트워크를 확인해 주세요.'
      : '연결을 확인하지 못했습니다. 주소와 인증 토큰을 확인해 주세요.';
  return `${reason}\n입력한 설정을 적용하지 않았습니다. ${hasVerifiedConnection ? '이전에 인증한 연결을 계속 사용합니다. 현재 사용 중인 주소를 아래에서 확인해 주세요.' : '현재 인증된 연결이 없습니다.'}`;
}
