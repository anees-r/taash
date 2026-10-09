export function Icon({ id, className }) {
  return <svg className={'i' + (className ? ' ' + className : '')} aria-hidden="true"><use href={'#' + id} /></svg>;
}
