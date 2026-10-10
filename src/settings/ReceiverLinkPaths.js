import { Circle, Path, Rect } from 'react-native-svg';
import { size } from '../theme/tokens';

// Packet silence does not mean the BLE link is gone. Reconnecting is its own design.
export const receiverLinkDesign = phase => ['connected', 'waiting', 'silent'].includes(phase)
  ? 'linked' : phase === 'connecting' ? 'connecting' : 'off';

export default function ReceiverLinkPaths({ phase = 'connected' }) {
  const design = receiverLinkDesign(phase);
  return <>
    <Rect x={6} y={11} width={size.receiver.bodyWidth} height={size.receiver.bodyHeight} rx={2} />
    <Path d="M12 11V6" />
    {design === 'linked' && <>
      <Path testID="receiver-link-signal" d="M8.5 6.5a5 5 0 0 1 7 0M6 4a8.5 8.5 0 0 1 12 0" />
      <Circle cx={12} cy={15.5} r={1.3} />
    </>}
    {design === 'off' && <Path testID="receiver-link-off" d="M3 3l18 18" />}
    {design === 'connecting' && <>
      <Circle testID="receiver-link-connecting" cx={18} cy={6} r={4} />
      <Path d="M18 3.5V6l1.5 1" />
    </>}
  </>;
}
