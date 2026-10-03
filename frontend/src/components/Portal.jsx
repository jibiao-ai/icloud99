import { createPortal } from 'react-dom';

/** 弹层统一挂到 body，避免被父级 overflow 裁剪。 */
export default function Portal({ children }) {
  return createPortal(children, document.body);
}
