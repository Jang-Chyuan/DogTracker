import React from 'react';
import { createDogDatabase } from './src/database/DogDatabase';
import HardwareScreen from './src/screens/HardwareScreen';

const dogDatabase = createDogDatabase();
export default function App() {
  return <HardwareScreen dogDatabase={dogDatabase} />;
}
