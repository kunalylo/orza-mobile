/** Recipes: generate (AI or ÖRZA's curated collection), save, and browse Saved / Recent. See src/features/recipes. */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { aiErrorInfo } from '@/features/chat/ai';
import { onRecipeDeleted, useGenerateRecipe, useRecipes, useToggleSave } from '@/features/recipes/api';
import { KitchenCard } from '@/features/recipes/KitchenCard';
import { RecipeGenerator, type GeneratorErrors } from '@/features/recipes/RecipeGenerator';
import { GeneratingCard, RecipeResultCard } from '@/features/recipes/RecipeResult';
import { RecipeTile } from '@/features/recipes/RecipeTile';
import type { GenerateRequest, Recipe } from '@/features/recipes/types';
import { ApiError, errorMessage } from '@/lib/api';
import { useAuth, useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { colors, gutter, spacing } from '@/theme';
import { EmptyState, Screen, ScreenHeader, Segmented, Skeleton, Text, toast } from '@/ui';

type Tab = 'saved' | 'recent';
const GENERATOR_FIELDS = new Set(['prompt', 'max_calories', 'cuisine', 'diet']);

export default function Recipes() {
  const user = useSignedInUser();
  const { setUser, refresh } = useAuth();
  const reduce = useReducedMotion();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const q = useRecipes();
  const generate = useGenerateRecipe();
  const save = useToggleSave();

  const [result, setResult] = useState<{ recipe: Recipe; notice?: string } | null>(null);
  const [errors, setErrors] = useState<GeneratorErrors>({});
  const [tab, setTab] = useState<Tab | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const lastRequest = useRef<GenerateRequest>({});
  const scrollRef = useRef<ScrollView>(null);
  const resultY = useRef(0);
  const scrollY = useRef(0);
  const viewportH = useRef(0);

  // Android leaves the scroll offset past the end when the content shrinks (a recipe deleted on its detail screen
  // closes the result card and empties the list) — the screen came back mostly blank until touched. Clamp it.
  function clampScroll(contentH: number) {
    const max = Math.max(0, contentH - viewportH.current);
    if (viewportH.current > 0 && scrollY.current > max + 1) {
      scrollY.current = max;
      scrollRef.current?.scrollTo({ y: max, animated: false });
    }
  }

  const recipes = q.data?.recipes ?? [];
  const saved = recipes.filter((r) => r.saved);
  const activeTab: Tab = tab ?? (saved.length ? 'saved' : 'recent');
  const list = activeTab === 'saved' ? saved : recipes;
  // The open result follows save / unsave made anywhere (list cache is the source of truth).
  const live = result ? (recipes.find((r) => r.id === result.recipe.id) ?? result.recipe) : null;

  // Deleting the result's recipe (on its detail screen, pushed above this one) closes the result card too.
  useEffect(() => onRecipeDeleted(qc, (id) => setResult((cur) => (cur?.recipe.id === id ? null : cur))), [qc]);

  const scrollToResult = () =>
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: Math.max(0, resultY.current - spacing.md), animated: !reduce }));

  async function runGenerate(req: GenerateRequest) {
    if (generate.isPending) return;
    lastRequest.current = req;
    setErrors({});
    setResult(null);
    scrollToResult();
    try {
      const res = await generate.mutateAsync(req);
      setResult({ recipe: res.recipe, notice: res.notice });
      if (typeof res.credits === 'number') {
        if (res.credits !== user.credits) setUser({ ...user, credits: res.credits });
      } else if (q.data?.ai_enabled) {
        void refresh();
      }
      haptics.success();
      toast.success(res.ai ? 'Your recipe is ready' : "Here's a recipe that fits you");
      scrollToResult();
    } catch (e) {
      haptics.error();
      const info = aiErrorInfo(e);
      // The view had scrolled down to the "cooking" card, which is gone now: back to the studio, where a field error
      // shows and "Generate recipe" can be tapped again.
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: !reduce }));
      if (info.field && GENERATOR_FIELDS.has(info.field)) setErrors({ [info.field]: info.message });
      else toast.error(info.message, info.needsCredits ? 6000 : undefined);
      if (info.needsCredits) void refresh();
    }
  }

  function toggleSave(r: Recipe) {
    if (save.isPending) return;
    save.mutate(r, {
      onSuccess: (next) => {
        haptics.success();
        toast.success(next.saved ? 'Saved to your cookbook' : 'Removed from saved');
      },
      onError: (e) => {
        haptics.error();
        toast.error(errorMessage(e));
        // Deleted on another device: the result card has nothing left to show.
        if (e instanceof ApiError && e.status === 404) setResult((cur) => (cur?.recipe.id === r.id ? null : cur));
      },
    });
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await q.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  let collection;
  if (q.isPending) {
    collection = (
      <View style={styles.tiles} accessibilityLabel="Loading your recipes">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={128} radius={20} />
        ))}
      </View>
    );
  } else if (q.isError && !q.data) {
    collection = <EmptyState icon="wifi-off" title="Couldn't load your recipes" body={errorMessage(q.error)} actionLabel="Try again" onAction={() => void q.refetch()} />;
  } else if (!list.length) {
    collection =
      activeTab === 'saved' ? (
        <EmptyState
          icon="mci:bookmark-plus-outline"
          title="No saved recipes yet"
          body={
            recipes.length
              ? 'Open a recipe from Recent and tap Save to keep it here.'
              : "Generate a recipe above and save the ones you love — they'll live here."
          }
          actionLabel={recipes.length ? 'Browse recent' : undefined}
          onAction={recipes.length ? () => setTab('recent') : undefined}
        />
      ) : (
        <EmptyState icon="mci:chef-hat" title="No recipes yet" body="Generate your first one above — try a quick breakfast or a high-protein dinner." />
      );
  } else {
    collection = (
      <View style={styles.tiles}>
        {list.map((r, i) => (
          <Animated.View
            key={r.id}
            entering={reduce ? undefined : FadeInDown.delay(Math.min(i, 8) * 40).springify().damping(18).stiffness(100).mass(1)}
            layout={reduce ? undefined : LinearTransition.springify().damping(20).stiffness(100).mass(1)}
          >
            <RecipeTile recipe={r} />
          </Animated.View>
        ))}
      </View>
    );
  }

  return (
    <Screen backdrop="orb" scroll={false} padded={false} keyboard edges={['top']} contentContainerStyle={styles.noPad}>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={64}
        onLayout={(e) => {
          viewportH.current = e.nativeEvent.layout.height;
        }}
        onContentSizeChange={(_, h) => clampScroll(h)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.coral} colors={[colors.coral]} />}
      >
        <ScreenHeader
          back
          large={false}
          eyebrow="Personalised recipes"
          title="Recipes"
          subtitle="AI-generated Indian recipes personalised for your goals — tuned to your diet, allergies and calorie budget."
        />

        <Animated.View entering={reduce ? undefined : FadeInDown.springify().damping(18).stiffness(100).mass(1)}>
          <RecipeGenerator
            aiEnabled={q.data ? q.data.ai_enabled : null}
            cost={q.data?.cost ?? 2}
            credits={user.credits}
            myDiets={q.data?.kitchen?.diets ?? (user.profile?.diet ? [user.profile.diet] : [])}
            generating={generate.isPending}
            errors={errors}
            onClearError={(f) => setErrors((x) => ({ ...x, [f]: undefined }))}
            onGenerate={runGenerate}
          />
        </Animated.View>

        <View
          onLayout={(e) => {
            resultY.current = e.nativeEvent.layout.y;
          }}
        >
          {generate.isPending ? (
            <View style={styles.block}>
              <GeneratingCard />
            </View>
          ) : live ? (
            <View style={styles.block}>
              <RecipeResultCard
                recipe={live}
                notice={result?.notice}
                onClose={() => setResult(null)}
                onAnother={() => void runGenerate(lastRequest.current)}
                generating={generate.isPending}
                onToggleSave={() => toggleSave(live)}
                saving={save.isPending && save.variables?.id === live.id}
              />
            </View>
          ) : null}
        </View>

        <Animated.View entering={reduce ? undefined : FadeInDown.delay(80).springify().damping(18).stiffness(100).mass(1)} style={styles.block}>
          <KitchenCard user={user} kitchen={q.data?.kitchen} />
        </Animated.View>

        <View style={styles.section}>
          <Text variant="eyebrow" tone="subtle">
            Your cookbook
          </Text>
          <Text variant="h2" style={styles.sectionTitle} accessibilityRole="header">
            Recipes made for you
          </Text>
          <Segmented<Tab>
            accessibilityLabel="Recipe collection"
            value={activeTab}
            onChange={(t) => {
              haptics.select();
              setTab(t);
            }}
            options={[
              { value: 'saved', label: q.isPending ? 'Saved' : `Saved · ${saved.length}` },
              { value: 'recent', label: q.isPending ? 'Recent' : `Recent · ${recipes.length}` },
            ]}
            style={styles.segmented}
          />
          {collection}
        </View>

        <Text variant="caption" tone="subtle" align="center" style={styles.note}>
          Wellness guidance, not medical advice. For medical concerns, please consult your doctor.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  noPad: { paddingBottom: 0 },
  content: { paddingHorizontal: gutter },
  block: { marginTop: spacing.lg },
  section: { marginTop: spacing.xxxl },
  sectionTitle: { marginTop: 4 },
  segmented: { marginTop: spacing.lg, marginBottom: spacing.lg },
  tiles: { gap: spacing.md },
  note: { marginTop: spacing.xxl, paddingHorizontal: spacing.lg },
});
