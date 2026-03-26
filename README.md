# Holy Baiak - Sprite Cache

Sprite sheets extraidos dos assets do client Holy Baiak para uso no NexusAAC via CDN.

## CDN

```
https://cdn.jsdelivr.net/gh/holybaiakteam/holybaiak-images@main/
```

## Estrutura

```
├── metadata.json              # Indice com lookTypes, animationPhases, phaseDurations
├── outfits/                   # Player outfits + creatures
│   ├── {id}-fg0-base.webp     # Frame group 0 (idle/static)
│   ├── {id}-fg1-base.webp     # Frame group 1 (walking/animated)
│   ├── {id}-fg{n}-mask-head.webp   # Mascara de cor (head)
│   ├── {id}-fg{n}-mask-body.webp   # Mascara de cor (body)
│   ├── {id}-fg{n}-mask-legs.webp   # Mascara de cor (legs)
│   └── {id}-fg{n}-mask-feet.webp   # Mascara de cor (feet)
└── items/                     # Items do jogo
    └── {id}-fg0-base.webp     # Sprite do item
```

## Uso no NexusAAC

O `sprite-renderer.ts` carrega `metadata.json` e renderiza via Canvas 2D no browser:

- Outfits com cores dinamicas (head/body/legs/feet)
- Animacoes com timing por criatura (phaseDurations do appearances.dat)
- Items estaticos e animados

## Geracao

Extraido com `holybaiak-sprite-renderer/tools/extract.ts` a partir dos assets do client.
