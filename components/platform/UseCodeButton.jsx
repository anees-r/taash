'use client';
import { useRouter } from 'next/navigation';
export function UseCodeButton({ code }) {
  const router = useRouter();
  return <button type="button" className="btn btn-sm" onClick={() => router.push('/t/' + code)}>Join</button>;
}
