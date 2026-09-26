'use strict';
/* ============================================================
 * PicFlow 轻量 AI 图像分类（完全离线）
 * 模型：MobileNetV2（int8 量化，约 4.3 MB）+ ImageNet 1000 类标签
 * 推理：onnxruntime-node（CPU），输入取自缩略图（440px JPEG）
 * 输出：面向二次元图库的七大类别 —— 角色图 / 风景图 / 插画·CG / 动物·萌宠 / 物品·道具 / 美食 / 其他
 * ============================================================ */
const path = require('path');
const fs = require('fs');

const CATEGORIES = ['角色图', '风景图', '插画·CG', '动物·萌宠', '物品·道具', '美食', '其他'];

let ort = null;        // onnxruntime-node 模块
let session = null;    // InferenceSession
let labels = null;     // ImageNet 标签数组

/* ---------- 类别关键词映射（对 ImageNet 同义词组做词边界匹配） ----------
 * 设计原则（面向二次元图库）：
 *  - 角色图优先级靠后但兜底：服饰/化妆品/头饰是 MobileNet 看人物时的高频输出，
 *    无关键词命中时低置信度默认归"角色图"（二次元图库基数最大类）。
 *  - 物品·道具放最后且关键词收紧：只保留明确的武器/乐器/车辆/家具/运动器材/厨具，
 *    去掉 ski/book jacket/pipe/stage/vase/umbrella 等容易把动漫角色/场景误判为物品的泛化词。
 */
const KW = {
  '动物·萌宠': [
    'fish', 'shark', 'ray', 'whale', 'dolphin', 'porpoise', 'eel', 'salmon', 'trout', 'carp',
    'goldfish', 'tench', 'barracouta', 'sturgeon', 'gar', 'lionfish', 'puffer', 'anemone',
    'octopus', 'squid', 'cuttlefish', 'nautilus', 'starfish', 'sea urchin', 'sea cucumber',
    'jellyfish', 'conch', 'snail', 'slug', 'chiton', 'crab', 'lobster', 'crayfish', 'hermit crab',
    'shrimp', 'krill', 'barnacle', 'bird', 'eagle', 'hawk', 'falcon', 'owl', 'parrot', 'macaw',
    'cockatoo', 'lorikeet', 'coucal', 'bee eater', 'hornbill', 'hummingbird', 'hen', 'cock',
    'rooster', 'chicken', 'quail', 'partridge', 'grouse', 'ptarmigan', 'turkey', 'peacock',
    'duck', 'goose', 'swan', 'flamingo', 'pelican', 'stork', 'crane', 'pigeon', 'dove',
    'ostrich', 'penguin', 'albatross', 'grebe', 'black stork', 'wood rabbit', 'hare', 'rabbit',
    'hamster', 'porcupine', 'fox', 'squirrel', 'marmot', 'beaver', 'guinea pig', ' mouse',
    'rat', 'weasel', 'mink', 'polecat', 'otter', 'skunk', 'badger', 'armadillo',
    'sloth', 'orangutan', 'gorilla', 'chimpanzee', 'gibbon', 'siamang', 'guenon', 'patas',
    'baboon', 'macaque', 'langur', 'colobus', 'proboscis monkey', 'marmoset', 'capuchin',
    'howler monkey', 'titi', 'spider monkey', 'squirrel monkey', 'Madagascar cat', 'indri',
    'elephant', 'tusk', 'rhinoceros', 'hippopotamus', 'horse', 'pony', 'zebra', 'donkey',
    'mule', 'hinny', 'deer', 'moose', 'elk', 'caribou', 'gazelle', 'antelope', 'ox', 'water buffalo',
    'bison', 'ram', 'bighorn', 'ibex', 'hartebeest', 'impala', 'camel', 'llama',
    'cow', 'cattle', 'calf', 'pig', 'hog', 'piggy', 'boar', 'lamb', 'sheep', 'goat',
    'koala', 'wombat', 'kangaroo', 'wallaby', 'possum', 'opossum', 'panda', 'dog', 'puppy',
    'pup', 'cat', 'kitten', 'kitty', 'lion', 'tiger', 'leopard', 'jaguar', 'cougar', 'lynx',
    'cheetah', 'bear', 'polar bear', 'brown bear', 'ice bear', 'black bear', 'wolf', 'timber wolf',
    'white wolf', 'red wolf', 'coyote', 'dhole', 'hyena', 'African hunting dog', 'raccoon',
    'corgi', 'retriever', 'shepherd', 'terrier', 'poodle', 'spaniel', 'collie', 'mastiff',
    'dachshund', 'beagle', 'chihuahua', 'pug', 'husky', 'malamute', 'samoyed', 'chow', 'pomeranian',
    'python', 'cobra', 'mamba', 'viper', 'boa', 'sea snake', 'sidewinder', 'horned viper',
    'lizard', 'gecko', 'iguana', 'chameleon', 'komodo', 'Gila monster', 'green lizard',
    'crocodile', 'alligator', 'caiman', 'dinosaur', 'turtle', 'tortoise', 'terrapin', 'box turtle',
    'mud turtle', 'loggerhead', 'leatherback', 'green turtle', 'frog', 'toad', 'tree frog',
    'tailed frog', 'bullfrog', 'spadefoot', 'salamander', 'newt', 'axolotl', 'fire salamander',
    'insect', 'butterfly', 'monarch', 'admiral', 'ringlet', 'sulphur butterfly', 'lycaenid',
    'bee', 'wasp', 'ant', 'honeybee', 'beetle', 'ladybug', 'ladybeetle', 'ground beetle',
    'dragonfly', 'damselfly', 'lacewing', 'walking stick', 'cicada', 'mantis', 'cricket',
    'grasshopper', 'hopper', 'cockroach', 'fly', 'housefly', 'mosquito', 'gnat', 'firefly',
    'spider', 'tarantula', 'wolf spider', 'dust mite', 'tick', 'harvestman', 'scorpion',
    'centipede', 'isopod', 'trilobite', 'worm', 'sea slug', 'chiton', 'barnacle'
  ],
  '美食': [
    'pizza', 'burger', 'cheeseburger', 'hotdog', 'hot dog', 'sandwich', 'honeycomb', 'omelet',
    'burrito', 'taco', 'guacamole', 'consomme', 'hot pot', 'trifle', 'ice cream', 'ice lolly',
    'icecream', 'French loaf', 'bagel', 'pretzel', 'mashed potato', 'spaghetti', 'carbonara',
    'noodle', 'ramen', 'sushi', 'sashimi', 'eggnog', 'red wine', 'espresso',
    'coffee', 'meat loaf', 'potpie', 'dough', 'chocolate sauce', 'baking',
    'broccoli', 'cauliflower', 'zucchini', 'spaghetti squash', 'acorn squash', 'butternut squash',
    'cucumber', 'artichoke', 'bell pepper', 'cardoon', 'mushroom', 'Granny Smith', 'strawberry',
    'orange', 'lemon', 'fig', 'pineapple', 'banana', 'jackfruit', 'custard apple', 'pomegranate',
    'acorn', 'peanut', 'corn', 'cabbage', 'head cabbage', 'lettuce', 'potato',
    'sweet potato', 'onion', 'garlic', 'ginger', 'carrot', 'apple', 'bakery', 'cake',
    'cupcake', 'cookie', 'cracker', 'waffle', 'pancake', 'pie', 'toast', 'cheese', 'egg', 'bacon',
    'ham', 'steak', 'chicken breast', 'fries', 'salad', 'dessert', 'sweets', 'confectionery'
  ],
  '风景图': [
    'lakeshore', 'lakeside', 'seashore', 'seacoast', 'coast', 'seaside', 'beach',
    'sandbar', 'sand bar', 'breakwater', 'promontory', 'headland', 'foreland', 'cliff',
    'drop curtain', 'valley', 'vale', 'volcano', 'alp', 'geyser', 'coral reef', 'rainforest',
    'mountain', 'mountainside', 'hillside', 'canyon', 'gorge', 'rift valley', 'iceberg', 'glacier',
    'ski slope', 'reservoir', 'watertower', 'prairie', 'grassland', 'hayfield', 'paddy',
    'rice paddy', 'wreck', 'volcanic crater', 'crater', 'lava', 'magma', 'bonsai', 'forest',
    'jungle', 'grove', 'orchard', 'vineyard', 'meadow', 'sunflower field', 'corn field',
    'alpine', 'snowfield', 'dune', 'desert', 'oasis', 'waterfall', 'cascade', 'rapids',
    'billabong', 'lagoon', 'bay', 'estuary', 'fjord', 'sound', 'strait', 'sea',
    'castle', 'cathedral', 'church', 'monastery', 'convent', 'mosque', 'stupa', 'palace',
    'triumphal arch', 'bell cote', 'dome', 'minaret', 'pagoda', 'temple', 'shrine',
    'skyline', 'skyscraper', 'office building', 'bank', 'cinema', 'movie theater', 'theater',
    'library', 'museum', 'prison', 'jail', 'boathouse', 'barn', 'greenhouse', 'granary',
    'solar dish', 'solarium', 'patio', 'terrace', 'balcony', 'stairway', 'railing',
    'picket fence', 'worm fence', 'stone wall', 'vault', 'yurt', 'tile roof', 'thatch',
    'sundial', 'suspension bridge', 'viaduct', 'steel arch bridge', 'steel bridge', 'stone bridge',
    'trestle bridge', 'drawbridge', 'maypole', 'podium', 'pulpit', 'altar', 'throne',
    'streetlight', 'street sign', 'traffic light', 'pier', 'lighthouse', 'beacon', 'windmill',
    'dam', 'fountain', 'park bench', 'dock', 'harbor', 'train station', 'railway station',
    'subway station', 'gas pump', 'gasoline pump', 'petrol pump', 'quadrangle'
  ],
  '插画·CG': [
    'comic book', 'book jacket', 'dust jacket', 'jigsaw puzzle', 'crossword puzzle', 'menu',
    'envelope', 'web site', 'website', 'screen', 'CRT screen', 'monitor', 'computer keyboard',
    'notebook', 'binder', 'web', 'page', 'newspaper', 'magazine', 'comic', 'manga', 'cartoon',
    'drawing', 'sketch', 'illustration', 'poster', 'pamphlet', 'handbill', 'billboard',
    'menu card', 'painting', 'art', 'canvas', 'sculpture', 'statue', 'bust'
  ],
  '角色图': [
    'bikini', 'two-piece', 'maillot', 'kimono', 'jersey', 'T-shirt', 'tee shirt', 'suit',
    'suit of clothes', 'gown', 'abaya', 'uniform', 'sweatshirt', 'cardigan', 'poncho', 'fur coat',
    'fez', 'sombrero', 'bonnet', 'shower cap', 'cowboy hat', 'sunbonnet', 'wig', 'mask',
    'oxygen mask', 'gas mask', 'face powder', 'lipstick', 'rouge', 'mascara', 'nail polish',
    'hair spray', 'hair slide', 'perfume', 'toiletry', 'sunglasses', 'necklace', 'neck brace',
    'running suit', 'overskirt', 'pajama', 'miniskirt', 'sarong', 'half-slip', 'military uniform',
    'swimming trunks', 'breastplate', 'cuirass', 'apron', 'bib', 'diaper', 'wardrobe', 'crinoline',
    'tights', 'leotard', 'raincoat', 'coat', 'trench coat', 'wool', 'velvet', 'sandal',
    'running shoe', 'loafer', 'ballet skirt', 'hat', 'cap', 'helmet', 'football helmet',
    'crash helmet', 'ski mask', 'tank suit', 'teddy', 'brassiere', 'stole', 'fur',
    'bowtie', 'bolo', 'sweater', 'pullover', 'turtleneck', 'blazer', 'cape', 'cloak'
  ],
  '物品·道具': [
    // 武器
    'revolver', 'rifle', 'assault rifle', 'shotgun', 'machine gun', 'carbine', 'cannon', 'tank',
    'projectile', 'missile', 'rocket', 'bow', 'crossbow', 'saber', 'scabbard', 'cleaver', 'axe',
    'hatchet', 'halberd', 'mace', 'lance', 'spear', 'rapier', 'dagger', 'stiletto', 'broadsword',
    // 乐器
    'guitar', 'electric guitar', 'banjo', 'cello', 'violin', 'harp', 'grand piano', 'upright piano',
    'acoustic guitar', 'steel drum', 'maraca', 'steel-string', 'trombone', 'French horn', 'cornet',
    'oboe', 'sax', 'saxophone', 'harmonica', 'flute', 'organ', 'steel pan', 'clavichord',
    // 车辆 / 载具
    'car', 'sports car', 'convertible', 'limousine', 'jeep', 'land rover', 'minivan', 'beach wagon',
    'taxi', 'truck', 'moving van', 'tow truck', 'garbage truck', 'forklift', 'crane',
    'trailer truck', 'tractor', 'streetcar', 'trolley', 'trolley bus', 'fire engine', 'police van',
    'ambulance', 'snowplow', 'amphibian', 'amphibious vehicle', 'boat', 'canoe', 'kayak', 'dinghy',
    'speedboat', 'catamaran', 'trimaran', 'fireboat', 'gondola', 'sailboat', 'sailing ship',
    'schooner', 'yacht', 'lifeboat', 'ship', 'airliner', 'warplane', 'drone', 'airplane',
    'airship', 'balloon', 'parachute', 'hang glider', 'spacecraft', 'scooter', 'moped',
    'motor scooter', 'motorcycle', 'motorbike', 'minibike', 'bicycle', 'mountain bike',
    'tricycle', 'unicycle', 'rickshaw', 'oxcart', 'horse cart', 'carriage', 'wheelchair',
    // 家具 / 钟表 / 文具 / 包
    'table lamp', 'lampshade', 'candle', 'torch', 'lighter', 'matchstick', 'hourglass', 'stopwatch',
    'digital clock', 'analog clock', 'wall clock', 'abacus', 'typewriter', 'printer', 'mailbox',
    'postbox', 'filing cabinet', 'safe', 'chest', 'coffin', 'carton', 'packet', 'plastic bag',
    'grocery bag', 'purse', 'handbag', 'briefcase', 'shopping cart', 'shopping basket',
    'bathtub', 'washbasin', 'sink', 'toilet seat', 'barber chair', 'desk', 'bookcase',
    'wardrobe', 'china cabinet', 'file cabinet', 'rocking chair', 'sofa', 'couch',
    'lounge', 'daybed', 'four-poster',
    // 运动器材
    'basketball', 'rugby ball', 'soccer ball', 'baseball', 'volleyball', 'croquet ball',
    'golf ball', 'ping-pong ball', 'billiard ball', 'racket', 'snowshoe', 'skateboard', 'surfboard',
    // 厨具 / 容器
    'caldron', 'cauldron', 'frying pan', 'wok', 'crockpot', 'spatula', 'ladle', 'strainer',
    'whisk', 'cocktail shaker', 'water jug', 'pitcher'
  ]
};

const ORDER = ['动物·萌宠', '美食', '风景图', '插画·CG', '角色图', '物品·道具']; // 匹配优先级（物品最后，减少动漫误判）

function buildMatchers() {
  const m = {};
  for (const [cat, words] of Object.entries(KW)) {
    m[cat] = words.map(w => {
      const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('(^|[^a-z])' + esc.toLowerCase() + '([^a-z]|$)', 'i');
    });
  }
  return m;
}
const MATCHERS = buildMatchers();

function mapCategory(top) {
  for (const cat of ORDER) {
    for (const t of top) {
      for (const re of MATCHERS[cat]) {
        if (re.test(t.label)) return { category: cat, hit: t.label, prob: t.prob };
      }
    }
  }
  // 无关键词命中：二次元图库中"识别不出"的多数是角色立绘/CG → 默认归角色图；
  // 若模型非常确信是某实物（高置信度）则归"其他"。
  if (top[0] && top[0].prob >= 0.45) return { category: '其他', hit: top[0].label, prob: top[0].prob };
  return { category: '角色图', hit: top[0] ? top[0].label : '', prob: top[0] ? top[0].prob : 0 };
}

/* ---------- 初始化 ---------- */
async function ensure(modelDir) {
  if (session) return true;
  if (!ort) ort = require('onnxruntime-node');
  const mp = path.join(modelDir, 'mobilenetv2-12-int8.onnx');
  const lp = path.join(modelDir, 'labels.txt');
  if (!fs.existsSync(mp)) throw new Error('模型文件缺失: ' + mp);
  if (!fs.existsSync(lp)) throw new Error('标签文件缺失: ' + lp);
  if (!labels) {
    labels = fs.readFileSync(lp, 'utf8').split('\n')
      .map(s => s.trim()).filter(Boolean)
      .map(line => { const parts = line.split(','); return (parts[1] || parts[0] || '').trim(); });
  }
  session = await ort.InferenceSession.create(mp, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all'
  });
  return true;
}

/* ---------- 预处理：图片 → 1x3x224x224 归一化张量 ---------- */
function preprocess(nativeImage) {
  let img = nativeImage;
  if (img.isEmpty()) return null;
  const sz = img.getSize();
  if (sz.width < 8 || sz.height < 8) return null;
  img = img.resize({ width: 224, height: 224, quality: 'good' });
  const buf = img.toBitmap(); // BGRA
  const n = 224 * 224;
  const data = new Float32Array(3 * n);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) {
    const si = i * 4, di = i;
    data[di] = (buf[si + 2] / 255 - mean[0]) / std[0];
    data[n + di] = (buf[si + 1] / 255 - mean[1]) / std[1];
    data[2 * n + di] = (buf[si] / 255 - mean[2]) / std[2];
  }
  return new ort.Tensor('float32', data, [1, 3, 224, 224]);
}

/* ---------- 分类一张图（传入 Electron nativeImage 对象） ---------- */
async function classifyImage(img) {
  if (!session) throw new Error('模型尚未初始化');
  const t = preprocess(img);
  if (!t) return null;
  const out = await session.run({ [session.inputNames[0]]: t });
  const logits = out[session.outputNames[0]].data;
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  const exps = new Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) { exps[i] = Math.exp(logits[i] - max); sum += exps[i]; }
  const idx = [];
  for (let i = 0; i < exps.length; i++) idx.push([exps[i] / sum, i]);
  idx.sort((a, b) => b[0] - a[0]);
  const top = idx.slice(0, 5).map(([p, i]) => ({ label: (labels[i] || ('class' + i)).toLowerCase(), prob: p }));
  const m = mapCategory(top);
  return { category: m.category, hit: m.hit, conf: m.prob, top };
}

module.exports = { CATEGORIES, ensure, classifyImage };
