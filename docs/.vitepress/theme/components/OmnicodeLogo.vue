<script setup lang="ts">
import logoUrl from '../omnicode.png'

withDefaults(defineProps<{ size?: number }>(), { size: 56 })
</script>

<template>
  <img
    class="OmnicodeLogo"
    :src="logoUrl"
    :width="size"
    :height="size"
    alt="Omnicode"
  />
</template>

<style scoped>
.OmnicodeLogo {
  display: block;
  object-fit: contain;
}
</style>
