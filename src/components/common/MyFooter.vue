<template>
  <div class="d-flex justify-content-between flex-row footer">
    <div class="">
      <a :href="website" target="_blank" class="orange">EOS NATION </a
      ><span class="text">© 2020</span>
    </div>
    <div class="">
      <router-link class="orange" :to="{ name: 'Privacy' }">
        Privacy Policy
      </router-link>
      <span class="text"
        >| Created with
        <font-awesome-icon
          icon="heart"
          fixed-width
          :style="{ color: '#e04f1a' }"
        />
        by
      </span>
      <a :href="website" target="_blank" class="fas orange">EOS Nation</a>
    </div>
  </div>
</template>

<script lang="ts">
import { Prop, Component, Vue } from "vue-property-decorator";

@Component({})
export default class MyFooter extends Vue {
  get website() {
    return "https://eosnation.io";
  }
}
</script>

<style lang="scss" scoped>
.footer {
  background-color: #1f2d36;
  padding: 15px 15px;
}

@media (min-width: 768px) {
  .footer {
    padding: 15px 100px;
  }
}

.text {
  color: white;
}

.orange {
  color: #d18235;
}
</style>
