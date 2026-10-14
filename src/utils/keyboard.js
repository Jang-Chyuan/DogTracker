import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

// The keyboard's height, 0 while it is down. The window is drawn edge to
// edge, so it does not shrink for the keyboard: what has to stay in sight
// (the guide's buttons, the dog's edit sheet) rides on top of it.
export function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const onShow = Keyboard.addListener('keyboardDidShow', event =>
      setHeight(event?.endCoordinates?.height || 0),
    );
    const onHide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);
  return height;
}
