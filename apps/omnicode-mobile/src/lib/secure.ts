import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { ProviderId } from './types';

function keyFor(provider: ProviderId): string {
  return `omnicode-key-${provider}`;
}

export async function saveApiKey(provider: ProviderId, key: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(keyFor(provider), key);
    return;
  }
  await SecureStore.setItemAsync(keyFor(provider), key);
}

export async function loadApiKey(provider: ProviderId): Promise<string> {
  if (Platform.OS === 'web') {
    return (await AsyncStorage.getItem(keyFor(provider))) ?? '';
  }
  return (await SecureStore.getItemAsync(keyFor(provider))) ?? '';
}

export async function deleteApiKey(provider: ProviderId): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(keyFor(provider));
    return;
  }
  await SecureStore.deleteItemAsync(keyFor(provider));
}
