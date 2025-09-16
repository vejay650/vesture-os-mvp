// pages/index.tsx
export default function Home() {
  return null;
}

export async function getServerSideProps() {
  return {
    redirect: {
      destination: "https://YOUR-FRAMER-SITE.framer.website/", // <- your Framer URL
      permanent: false,
    },
  };
}
