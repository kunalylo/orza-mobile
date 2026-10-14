/** One recipe: ingredients checklist, method, nutrition — save / unsave, log a serving, delete. */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, RefreshControl, StyleSheet, View } from 'react-native';

import { useDeleteRecipe, useLogServing, useRecipe, useToggleSave } from '@/features/recipes/api';
import { RecipeDetail } from '@/features/recipes/RecipeDetail';
import { ApiError, errorMessage } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { colors, spacing } from '@/theme';
import { Button, EmptyState, IconButton, Screen, Skeleton, Text, goBackOrHome, toast } from '@/ui';

function DetailSkeleton() {
  return (
    <View style={styles.skeleton} accessibilityLabel="Loading recipe">
      <Skeleton width="40%" height={12} />
      <Skeleton width="85%" height={34} radius={10} />
      <Skeleton width="100%" height={14} />
      <Skeleton width="70%" height={14} />
      <Skeleton width="100%" height={72} radius={16} style={styles.gap} />
      <Skeleton width="100%" height={220} radius={20} style={styles.gap} />
    </View>
  );
}

export default function RecipeScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = typeof rawId === 'string' ? rawId : '';
  const q = useRecipe(id);
  const save = useToggleSave();
  const log = useLogServing();
  const del = useDeleteRecipe();
  const [refreshing, setRefreshing] = useState(false);
  const recipe = q.data;

  async function refresh() {
    setRefreshing(true);
    try {
      await q.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  function toggleSave() {
    if (!recipe || save.isPending) return;
    save.mutate(recipe, {
      onSuccess: (r) => {
        haptics.success();
        toast.success(r.saved ? 'Saved to your cookbook' : 'Removed from saved');
      },
      onError: (e) => {
        haptics.error();
        toast.error(errorMessage(e));
      },
    });
  }

  function logServing() {
    if (!recipe || log.isPending) return;
    log.mutate(recipe, {
      onSuccess: () => {
        haptics.success();
        toast.success(`Logged 1 serving of ${recipe.title}`);
      },
      onError: (e) => {
        haptics.error();
        toast.error(errorMessage(e));
      },
    });
  }

  function confirmDelete() {
    if (!recipe) return;
    haptics.warning();
    Alert.alert('Delete this recipe?', `“${recipe.title}” will be removed from your cookbook.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          del.mutate(recipe.id, {
            onSuccess: () => {
              haptics.success();
              toast.success('Recipe deleted');
              goBackOrHome();
            },
            onError: (e) => {
              haptics.error();
              toast.error(errorMessage(e));
            },
          }),
      },
    ]);
  }

  const notFound = q.error instanceof ApiError && q.error.status === 404;

  const header = (
    <View style={styles.header}>
      <IconButton icon="arrow-left" accessibilityLabel="Go back" onPress={goBackOrHome} size={40} />
      {recipe ? (
        <IconButton
          icon={recipe.saved ? 'mci:bookmark-check' : 'mci:bookmark-outline'}
          color={recipe.saved ? colors.energyInk : colors.ink}
          accessibilityLabel={recipe.saved ? 'Remove from saved' : 'Save recipe'}
          onPress={toggleSave}
          disabled={save.isPending}
          size={40}
        />
      ) : null}
    </View>
  );

  if (!recipe) {
    return (
      <Screen backdrop="orb" header={header}>
        {q.isPending ? (
          <DetailSkeleton />
        ) : (
          <View style={styles.center}>
            <EmptyState
              icon={notFound ? 'mci:chef-hat' : 'wifi-off'}
              title={notFound ? "That recipe doesn't exist anymore." : "Couldn't load this recipe"}
              body={notFound ? 'It may have been deleted on another device.' : errorMessage(q.error)}
              actionLabel={notFound ? 'Back to recipes' : 'Try again'}
              onAction={notFound ? () => router.replace('/recipes') : () => void q.refetch()}
            />
          </View>
        )}
      </Screen>
    );
  }

  return (
    <Screen
      backdrop="orb"
      header={header}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.coral} colors={[colors.coral]} />}
      footer={
        <View style={styles.footer}>
          <Button
            label={recipe.saved ? 'Saved' : 'Save recipe'}
            icon={recipe.saved ? 'check' : 'bookmark'}
            variant={recipe.saved ? 'secondary' : 'primary'}
            loading={save.isPending}
            haptic="soft"
            onPress={toggleSave}
            style={styles.flex}
            accessibilityLabel={recipe.saved ? 'Saved — tap to remove from saved' : 'Save recipe'}
          />
          <Button label="Log 1 serving" icon="plus" variant="energy" loading={log.isPending} haptic="firm" onPress={logServing} style={styles.flex} />
        </View>
      }
    >
      <RecipeDetail recipe={recipe} />
      <Button label="Delete recipe" icon="trash-2" variant="ghost" size="sm" loading={del.isPending} onPress={confirmDelete} style={styles.delete} />
      <Text variant="caption" tone="subtle" align="center" style={styles.note}>
        Wellness guidance, not medical advice. For medical concerns, please consult your doctor.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: spacing.sm, paddingBottom: spacing.md },
  center: { flex: 1, justifyContent: 'center' },
  skeleton: { gap: spacing.md, paddingTop: spacing.sm },
  gap: { marginTop: spacing.md },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: 20,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: 'rgba(251,247,241,0.94)',
  },
  delete: { alignSelf: 'center', marginTop: spacing.xxl },
  note: { marginTop: spacing.md, paddingHorizontal: spacing.lg },
});
