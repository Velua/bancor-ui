import Vue from "vue";
import Router, { RouteConfig } from "vue-router";
import Wallet from "@/views/Wallet.vue";
import WalletAccount from "@/views/WalletAccount.vue";
import Tokens from "@/views/Tokens.vue";
import Relays from "@/views/Relays.vue";
import HeroConvert from "@/components/hero/sub/HeroConvert.vue";
import HeroTransfer from "@/components/hero/sub/HeroTransfer.vue";
import HeroRelay from "@/components/hero/sub/HeroRelay.vue";
import HeroCreate from "@/components/hero/sub/HeroCreate.vue";
import Navigation from "@/components/layout/Navigation.vue";
import { vxm } from "@/store/";


Vue.use(Router);

const networkNamespaces = ["eos", "eth"];

const commonRoutes = [
  {
    path: "",
    name: "Tokens",
    components: {
      Nav: Navigation,
      default: Tokens,
      Hero: HeroConvert
    }
  },
  {
    path: "/transfer/:symbolName",
    name: "Transfer",
    components: {
      Nav: Navigation,
      default: Tokens,
      Hero: HeroTransfer
    },
    props: true
  },
  {
    path: "/relays",
    name: "Relays",
    components: {
      Nav: Navigation,
      default: Relays,
      Hero: HeroRelay
    }
  },
  {
    path: "/relay/:account",
    name: "Relay",
    components: {
      Nav: Navigation,
      default: Relays,
      Hero: HeroRelay
    },
    props: true
  },
  {
    path: "/wallet",
    name: "Wallet",
    components: {
      Nav: Navigation,
      default: Wallet
    }
  },
  {
    path: "/wallet/:account",
    name: "WalletAccount",
    components: {
      Nav: Navigation,
      Hero: HeroTransfer,
      default: WalletAccount
    },
    props: true
  },
  {
    path: "/:symbolName",
    name: "Token",
    components: {
      Nav: Navigation,
      default: Tokens,
      Hero: HeroConvert
    },
    props: true
  }
];

//@ts-ignore
const builtRoutes: RouteConfig[] = networkNamespaces
  .map(network =>
    commonRoutes.map(commonRoute => ({
      ...commonRoute,
      path: "/" + network + commonRoute.path,
      name: `${network}-${commonRoute.name}`
    }))
  )
  .flat(1);
console.log(builtRoutes);

export const router = new Router({
  mode: "history",
  base: process.env.BASE_URL,
  linkExactActiveClass: "active",
  scrollBehavior(to, from, savedPosition) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (savedPosition) {
          resolve(savedPosition);
        } else {
          resolve({ x: 0, y: 0 });
        }
      }, 500);
    });
  },
  routes: [
    {
      path: "*",
      redirect: "/eos"
    },
    {
      path: "/",
      redirect: "/eos"
    },
    ...builtRoutes,
    {
      path: "/eos/relays/create",
      name: "eos-Create",
      components: {
        Nav: Navigation,
        default: Relays,
        Hero: HeroCreate
      }
    }
  ]
});

router.beforeEach((to, from, next) => {
  if (to && to.name && to.name.includes("-")) {
    const originNetwork = to.name.split('-')[0]
    if (vxm.relays.selectedNetwork !== originNetwork) {
      vxm.relays.setNetwork(originNetwork)
    }
    next();
  }
  else {
    const originNetwork = from && from && from.name && from.name.split("-")[0];
    if (originNetwork) {
      vxm.relays.setNetwork(originNetwork);
      next({ name: `${originNetwork}-${to.name}`, params: to.params });
    } else {
      next();
    }
  }
});
