import { Tabs } from 'expo-router/js-tabs';
import { useEffect } from 'react';

import { TabBar } from '@/components/TabBar';
import { recoverSnapPhoto } from '@/features/snap/pending';
import { colors } from '@/theme';

export default function TabsLayout() {
  // A meal photo taken just before Android stopped ÖRZA (low memory while the camera was open) → back to Snap with it.
  useEffect(() => {
    void recoverSnapPhoto().catch(() => null);
  }, []);

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.canvas }, animation: 'shift' }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today' }} />
      <Tabs.Screen name="meals" options={{ title: 'Meals' }} />
      <Tabs.Screen name="snap" options={{ title: 'Snap' }} />
      <Tabs.Screen name="medicines" options={{ title: 'Medicines' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
