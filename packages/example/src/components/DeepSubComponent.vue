<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ msg: string }>()

const count = ref(0)
</script>

<template>
  <p class="foo">{{ msg }}</p>
</template>

<style scoped>

.foo {
  color: rgb(44, 146, 35);
}

</style>
