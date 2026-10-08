import { APP_VERSION } from '../version';
import { HeartIcon } from './icons';

export function Footer() {
  return (
    <footer className="footer">
      <span className="footer__version">v{APP_VERSION}</span>
      <span className="footer__dot" aria-hidden="true" />
      <span className="footer__credit">
        Made with <HeartIcon size={12} className="footer__heart" aria-label="love" role="img" /> by Kheelesh Poorun
      </span>
    </footer>
  );
}
