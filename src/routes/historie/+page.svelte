<script lang="ts">
  import HistoryList from '#lib/components/HistoryList.svelte';
</script>

<svelte:head>
  <title>Historie změn – Pražský přebor mužů</title>
</svelte:head>

<div class="page">
  <h1>Historie změn</h1>
  <p class="lead muted">
    Každý zápis, úprava i smazání. Když něco nesedí, změnu jde vrátit. Vrácení se samo zapíše do historie, takže se dá
    zase vrátit zpátky.
  </p>
  <HistoryList limit={40} />
</div>

<style>
  .lead {
    margin: 14px 0 24px;
    font-size: 17px;
    max-width: 65ch;
  }
</style>
