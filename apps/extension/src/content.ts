import { installFloatingSave } from './floatingSave';
import { sendFloatingCaptureMessage } from './contentMessaging';
import styles from './floatingSave.css?inline';

installFloatingSave(
  document,
  async (payload) =>
    sendFloatingCaptureMessage({
      type: 'floating_capture',
      payload,
    }),
  styles,
);
