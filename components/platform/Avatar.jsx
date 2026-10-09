import { hueFor, initials } from '@/lib/client/format';

/** @param {{person:{name:string, guest?:boolean}, size?:'sm'|'lg'|'xl', status?:'on'|'away'|null}} p */
export function Avatar({ person, size, status }) {
  return (
    <span className={'avatar' + (size ? ' ' + size : '') + (person.guest ? ' guest' : '')} style={{ '--hue': hueFor(person.name) }} aria-hidden="true">
      {initials(person.name)}
      {status ? <span className={'status-dot ' + status} /> : null}
    </span>
  );
}
