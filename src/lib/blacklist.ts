import { addressBookByChainId } from 'blockchain-addressbook';
import { type Logger, S } from 'envio';
import type { HandlerContext } from 'generated/src/Types';
import * as R from 'remeda';
import type { Hex } from 'viem';
import { isClassicBoost } from '../entities/classicBoost.entity';
import { isErc4626Adapter } from '../entities/classicErc4626Adapter.entity';
import { isClassicVaultStrategy } from '../entities/classicVault.entity';
import { isRewardPool } from '../entities/rewardPool.entity';
import { allChainIds, type ChainId } from './chain';
import { config } from './config';

export const rawVaultBlacklist =
    // rg -Ni '\[BLACKLIST\]' ./generated/hyperindex.log | jq -c '{chainId, address: .contractAddress}'
    [
        { chainId: 10, address: '0x07ae77025feaf04f915375bc5f02c07545160db8' },
        { chainId: 10, address: '0x136b941dcb35860b097473e1bc7b673ade32c61f' },
        { chainId: 10, address: '0x242fc9f6c7e967c146a6f8a027c6f1910bde3cf1' },
        { chainId: 10, address: '0x2666f279b357f00563b077c9fe24f852492cf1c9' },
        { chainId: 10, address: '0x297f0072c5b97b7ea96aee9e00cdd6c5241d433b' },
        { chainId: 10, address: '0x2da2d873450d2f0b3c1c7893f16dfb342f9c8492' },
        { chainId: 10, address: '0x3450cac0f4db00d21c833218cce8f970035a4398' },
        { chainId: 10, address: '0x3d5dfb6241bf611e472df9affc44711b2f81939e' },
        { chainId: 10, address: '0x44913882fe27452e51bfce17849df7ffc3e9ba0f' },
        { chainId: 10, address: '0x4d43883b097224a2d0a10788ee482ead088271a5' },
        { chainId: 10, address: '0x4f1c1567b2d1d4d92dc62e0ec791557e1589048d' },
        { chainId: 10, address: '0x53e2c2289795181ae6ff5dd62cb85865b182d3f2' },
        { chainId: 10, address: '0x5701d18ccc8f58d484b8037c8619812ff197e172' },
        { chainId: 10, address: '0x5d84f3940e1ac23dd775d70815edcd86ef0c1a40' },
        { chainId: 10, address: '0x611656643afe500fd669178b0708c1098429b7c5' },
        { chainId: 10, address: '0x6521a5b613e35c30980fe38e87aac3aa73e1713d' },
        { chainId: 10, address: '0x679258e1eef85c41f2bfc4923790ee1a5cc370bf' },
        { chainId: 10, address: '0x6af02eb5177617ba40947084bdcdb7d4731b205a' },
        { chainId: 10, address: '0x70564a606d492dcbae6427fcca71fd8e824e9c93' },
        { chainId: 10, address: '0x779283f6530bea6a102a3d474259a5c3ce78224a' },
        { chainId: 10, address: '0x7ee71053102d54fc843baebaf07277c2b6db64f1' },
        { chainId: 10, address: '0x86aeeab4c98ed77a02960134a759eba99237d321' },
        { chainId: 10, address: '0x8e90bb08eed12556119aa4ed6a5b014856d1078b' },
        { chainId: 10, address: '0x9357702b0801383535315372420e94d6e2a10901' },
        { chainId: 10, address: '0x9793831abec4563975da7b01f7f9ba5df61b44c7' },
        { chainId: 10, address: '0xb135ae335f37737aa9e7ba8250e5f5a9b11e2323' },
        { chainId: 10, address: '0xb4dabdaccdc20a081cf24b6d6ef3a6b1c84d46a7' },
        { chainId: 10, address: '0xb6b34cbd11f7ddd83d2d92d84f4c706a8962e04c' },
        { chainId: 10, address: '0xbb692b48ca5388b8d2f468bad5d2c60e9ef6b70c' },
        { chainId: 10, address: '0xce630c6e875b23f824a5fc223793caab92898e6a' },
        { chainId: 10, address: '0xd3bd1cf364da0621e4ff02ba556ab57436892c6d' },
        { chainId: 10, address: '0xdabb979a4e92db23e1ce08ffb0049a9700e2e4cd' },
        { chainId: 10, address: '0xe16809f1328aa9c98ad2614b5e63f9c6263f141a' },
        { chainId: 10, address: '0xe367c7f701e9ed18d592833d41fabef5265af7be' },
        { chainId: 10, address: '0xea5044342afac5d48de995807901b85b4a7e4a1b' },
        { chainId: 10, address: '0xeadcafa602555ab68d784bdaf181689a28d8e62e' },
        { chainId: 10, address: '0xec3696b791c21502ac0c8da248b97cab3e12cd0a' },
        { chainId: 10, address: '0xec4b69ff273be97874d063d18082da911a4fb135' },
        { chainId: 10, address: '0xf3080cfecd9a686d9db8bdbf28d441e45dab5a08' },
        { chainId: 10, address: '0xf71ad2d624170113be8730a1cc47ac5f69c49085' },
        { chainId: 10, address: '0xfaaf5c8b3addb79db2372c5e9703b6106ce6f94c' },
        { chainId: 100, address: '0x47b75ddc83c0012f2b35f248a3188a977f8b326b' },
        { chainId: 100, address: '0x481f365b3f086d76a55b8df589b791a3fb51a94b' },
        { chainId: 100, address: '0x99b2b3330d68f9acfd9a5b09b92158f4857a3bef' },
        { chainId: 100, address: '0xddf0c27c6f6be455fefbf563dd95d8833f1d7af7' },
        { chainId: 100, address: '0xf1fbf36124c00567748782df54d47e7f09c91ab4' },
        { chainId: 1101, address: '0x14ddbe02df312a7419d0da521d24ec918f21a746' },
        { chainId: 1135, address: '0x7337ff45914bef0238198e4f8dc22a38ce121aea' },
        { chainId: 1135, address: '0xb422c9215aaca788848dfc8134ad1d5de0652ff2' },
        { chainId: 1284, address: '0x21f6a933f3dc7f34a1908dffff7d9fec699cfd95' },
        { chainId: 1284, address: '0x57de8fafb97a0a8e051fd01a91f707280cba809b' },
        { chainId: 1284, address: '0xb7eae5ec5c002f8f747df6c671aaa4fa51bb630f' },
        { chainId: 1329, address: '0xfb6d10761c6830de80c90264901224b2670d215c' },
        { chainId: 137, address: '0x0d269aac25ad33653185ccdaf2239b7bcd0f5fc2' },
        { chainId: 137, address: '0x10510c6c9989fbb54e56658a47ce4b837553c5db' },
        { chainId: 137, address: '0x14bce5a8023a6264bbee3d2ef4586f633eb901d1' },
        { chainId: 137, address: '0x1697eb773c8d626f8d80e0923279d97348b47029' },
        { chainId: 137, address: '0x27822f864b584daa61b51d324fc11d27a74b5410' },
        { chainId: 137, address: '0x2eb75a5e6e227006a01ca49e2c8231a439d24e08' },
        { chainId: 137, address: '0x3c7b7ac6ddac2fcf2e903267199b7f7a125948fb' },
        { chainId: 137, address: '0x42b661e3f4acee1d496f7133fc545dd6ba25d493' },
        { chainId: 137, address: '0x45c11d160935b69cc8400d4b5a15d011a7618de6' },
        { chainId: 137, address: '0x4c08295817485141c3a89202843b4405701d42e1' },
        { chainId: 137, address: '0x4e6d94e9a719f5c48274402668f6abe4d95ceeed' },
        { chainId: 137, address: '0x503f5d70ed1056d38f35032882fd98649acef8d9' },
        { chainId: 137, address: '0x51fc4371d03534f378b86498041995714b3562d4' },
        { chainId: 137, address: '0x5666778cbdce7e5b7666c25aec05720ad8654231' },
        { chainId: 137, address: '0x58acfe5479f5460b90046586ddee82e620c1b82f' },
        { chainId: 137, address: '0x5b76906663b4ae740aca844b11ea28b36f1aa8be' },
        { chainId: 137, address: '0x6ae96cc93331c19148541d4d2f31363684917092' },
        { chainId: 137, address: '0x6c7bc79594a59ff517d8e19b7cb8ae6d896082b2' },
        { chainId: 137, address: '0x6f0d573ff8a8af15c47475450bd250161b6501cb' },
        { chainId: 137, address: '0x72d7c295e7945a09affc14c656e898a79b7eac4e' },
        { chainId: 137, address: '0x761d99ca021ac8b138fc598ffba322e07ab247f9' },
        { chainId: 137, address: '0x7841d96596cef1eaf18aaa8389df3cf2f3e12101' },
        { chainId: 137, address: '0x78a2470889231521b9ffc59fffbaa051b20e2c09' },
        { chainId: 137, address: '0x79305315e406756d3965a770fd54ae7d853bd437' },
        { chainId: 137, address: '0x7f1dfc6e3cbabd0df7d861cedbff31e8c569eadb' },
        { chainId: 137, address: '0x7f9d2ce4aa46ee6d42de55e338b0f040e88d41e0' },
        { chainId: 137, address: '0x82692d5fa7681010d292770dc81b9fd33087e750' },
        { chainId: 137, address: '0x858d68e03f2104494678e4e78445ff4c6e3fdb57' },
        { chainId: 137, address: '0x895fced0160ed5a25c20daef3bf560a6193b547e' },
        { chainId: 137, address: '0x8fb2da68e12e9927fe675387b336352c7652905c' },
        { chainId: 137, address: '0x96ad60be6da9829a0135409e010d05099700d692' },
        { chainId: 137, address: '0x97aecfa31106ce9a327d05303a01219ad7c61fea' },
        { chainId: 137, address: '0x9ed8a96409206ad6ed3f007f16c714452912b017' },
        { chainId: 137, address: '0x9f17ca3dc9efe20e90980b1ea32ac2f610665cf1' },
        { chainId: 137, address: '0xa664dc64d801e487ff123992ef2c9949b4955b87' },
        { chainId: 137, address: '0xab542e4099102b6a47cf09af1a1c038fc2629457' },
        { chainId: 137, address: '0xae22cb29b290c0780b782ef53a5c24718722c761' },
        { chainId: 137, address: '0xae85e4608c709a509fd7d690c9ef58e8751dae69' },
        { chainId: 137, address: '0xaecf34b292c92a90778377b485c48d8dd4641007' },
        { chainId: 137, address: '0xb6c0e4674b67650b76d59a7f0f4d92b5b3790ef3' },
        { chainId: 137, address: '0xb7d58c9d8537fa4b83e2b1cf53f73c8f7709b45b' },
        { chainId: 137, address: '0xbe8178575873f111d4a47ff5963cdd6750f5ff6e' },
        { chainId: 137, address: '0xc0163ae9e9dceff030249f33036a01520dc29684' },
        { chainId: 137, address: '0xc0cb143bb85470dbe20c787c4bbcac68ed632613' },
        { chainId: 137, address: '0xc63395ab04e08fe2e48b97dc917130bb47641736' },
        { chainId: 137, address: '0xc67c3af465ccfb4eb5f48f8f95e1222242653256' },
        { chainId: 137, address: '0xc8436638acfaebbde20f6e1757901990df6814ed' },
        { chainId: 137, address: '0xcb14efcfcd4890f5b1084024a8a781721124460d' },
        { chainId: 137, address: '0xce09d8d2bf3a1c1dcfb7252b2a3e0314e53fcdc6' },
        { chainId: 137, address: '0xd060a6a135477a33af5324e785c9cd8ef515cbdc' },
        { chainId: 137, address: '0xd5b7a7fead9ea985d78dc64da6ed9ba2fd560667' },
        { chainId: 137, address: '0xd6e22ea2df2f929c4ec1cfd3630d4b67cadcbd87' },
        { chainId: 137, address: '0xd903f9a2c1c4d4a3cd1aac7021333549e717fcee' },
        { chainId: 137, address: '0xda0841b0be1428c7195bbad5d650839c37e68407' },
        { chainId: 137, address: '0xdc2ade1e285c78b8a3d6d455bb0e1d9ecbad4761' },
        { chainId: 137, address: '0xe1c615248f786bb7f37fdcbbb40f436ca935a073' },
        { chainId: 137, address: '0xe4d610537a2ee2b58568d735807338d9cc65b41b' },
        { chainId: 137, address: '0xe5b36d6f9881df006c964e455ef4c09ab775edc3' },
        { chainId: 137, address: '0xe60527a7a83f0ebaa4a8c8ae360bc18d58f0ab4c' },
        { chainId: 137, address: '0xe87cbd763517760277abed58d5baefcf0af11581' },
        { chainId: 137, address: '0xe94f29067205de23ddd4d8ed1b4e61b25bb37e4b' },
        { chainId: 137, address: '0xf3e4042e66a31268ef4750b85ecedaead60b93ca' },
        { chainId: 146, address: '0x0d73dbe52408fd82510aa4246c250dcf155abf5e' },
        { chainId: 146, address: '0xabcc668a224cbc05012ab1fb5c439684b18dc080' },
        { chainId: 146, address: '0xdcdbc5103b1aa5f5ec72f5cb9c144ef08b60f7fc' },
        { chainId: 2222, address: '0x18b728d955d4c501433dc793be1647fd3ff5e0a5' },
        { chainId: 2222, address: '0x206caf26262418e1cb6be3092672f7bf4f7aba93' },
        { chainId: 2222, address: '0xa480bc6b2049351e0c029ef4569640266db1b330' },
        { chainId: 2222, address: '0xc86c7c0efbd6a49b35e8714c5f59d99de09a225b' },
        { chainId: 250, address: '0x012545d8babb689f8d0f3ca701bb2f6f3f0916b1' },
        { chainId: 250, address: '0x233f41ab27f532e48f2b48af8fb06ef97f9f2501' },
        { chainId: 250, address: '0x2d28a9701f0efc7d0b1f7fcf46092d5c2bb71488' },
        { chainId: 250, address: '0x329d482431691bf14ff9de2160e3b3cb14007d9d' },
        { chainId: 250, address: '0x36ffbdfd369347463535b416fe1a9fb9dfdb0264' },
        { chainId: 250, address: '0x432361e7f853ce1848d46942fecb13bc4263d1ac' },
        { chainId: 250, address: '0x49c68edb7aebd968f197121453e41b8704acde0c' },
        { chainId: 250, address: '0x54eb10c9fee9570404eba4afed60daa19c9b61ae' },
        { chainId: 250, address: '0x7cba0d819c3778c9d05af08b1d5f2e8c0b8a0166' },
        { chainId: 250, address: '0x8afc0f9BdC5DcA9f0408Df03A03520bFa98A15aF' },
        { chainId: 250, address: '0x8d63fd98288c830a6e7b0ad9c22225304d4b63c2' },
        { chainId: 250, address: '0xa90b43f55dc709fb0417fc11dd5e39d90eb08862' },
        { chainId: 250, address: '0xafc532a006f24abb0835b86a23e06595662bb89d' },
        { chainId: 250, address: '0xc3812130b86c2083fdd37aaa9c6bc6c011f95fa7' },
        { chainId: 250, address: '0xce3820daeb2cd11a685f9c5a69d3a2c45b283c12' },
        { chainId: 30, address: '0xd0019d13d2f2eb3ba81bca1650cd45cd2db6526e' },
        { chainId: 324, address: '0x3355df6d4c9c3035724fd0e3914de96a5a83aaf4' },
        { chainId: 34443, address: '0x4ad02bf095b8ffb6e0ac687beee5610ca3ebe6b1' },
        { chainId: 34443, address: '0xde59ca36f43ed1fa7ab67c419fc20be12a868712' },
        { chainId: 42161, address: '0x009b340fffa28bfb18e6247e90ff4539728c67af' },
        { chainId: 42161, address: '0x0311372fc28f1be254853005b67e0e82942cbd4d' },
        { chainId: 42161, address: '0x038fad2c4511aefa6da58a0a61751280bd96719c' },
        { chainId: 42161, address: '0x07537ffa6b35936d8c5fb8a31a2ed5f096eb0636' },
        { chainId: 42161, address: '0x0d7338756a2405897d949d9fd65d134fc2ed412d' },
        { chainId: 42161, address: '0x0ee3c1197994f4e5c8d979770fd4c32a936f59ed' },
        { chainId: 42161, address: '0x116c2901f8dbedd3bb496eb1cf6852ca31d2fbb9' },
        { chainId: 42161, address: '0x15b7395120f71d4494b3623c95aae03e1db62dff' },
        { chainId: 42161, address: '0x1871e965a4ee3c31967c12a498cfe2906bc24c73' },
        { chainId: 42161, address: '0x25867466dda6a98d624e66ea6219d224bb67dd53' },
        { chainId: 42161, address: '0x26ffab23fd3c045a0528c3a850e9c54c132b5bb5' },
        { chainId: 42161, address: '0x28658dd35eb78bf9d8864d9ecda7635c98b2b5a9' },
        { chainId: 42161, address: '0x293bf49df5400692c603ebdec52ef2b5dcb4a0c0' },
        { chainId: 42161, address: '0x312a6a878e73d9d31784c1c74509fc5f3b34ca60' },
        { chainId: 42161, address: '0x3224abd5f09ee123a61623d0e45f96b5e765bef6' },
        { chainId: 42161, address: '0x332d4f7960fd8a927e40313f6d60c6f980cc593e' },
        { chainId: 42161, address: '0x33efe9575d9f7cba7de3f3629a9b7af6ca824a4c' },
        { chainId: 42161, address: '0x416f0bd06626238417daaf4011a18485bc36c021' },
        { chainId: 42161, address: '0x46bbbb4f96f2477de6ddbcef5f40166b44ed5428' },
        { chainId: 42161, address: '0x50ef867338612f14ccc2c19a56d644215ecca08a' },
        { chainId: 42161, address: '0x59aba63e2fd94dc8099f27f016e460dc26123bf8' },
        { chainId: 42161, address: '0x5b8e8192c185da96d6ef558c8ee2b004dc50a3bc' },
        { chainId: 42161, address: '0x6accf288ce7e94f6fe443c5d95c21f36a2d5b83d' },
        { chainId: 42161, address: '0x6e48ec7136bb07c6af61bfe722b0fcd9516d8391' },
        { chainId: 42161, address: '0x709dc654539a696ae78e9575ea0d0c708f211e19' },
        { chainId: 42161, address: '0x71ad45323deb1fcc3dc52d9e82725e2c2894f8dc' },
        { chainId: 42161, address: '0x72e6a8bde152ca4bd31a1b09df86605fe081d91b' },
        { chainId: 42161, address: '0x7513d17dc4aaf9009f8602853344585b9b76b102' },
        { chainId: 42161, address: '0x76a89ea66aad21614015535055a17f0605cccded' },
        { chainId: 42161, address: '0x7e0021735b43ddb7d66f9921e73b953869cd6cbb' },
        { chainId: 42161, address: '0x80cd2596f7a7cd0d002e4a66c68885f021312f2c' },
        { chainId: 42161, address: '0x82b22e0d09b0aa84b89ed00c0b86e3d8604e639f' },
        { chainId: 42161, address: '0x8af8104d49f1e44fd4d0225b5b16546026fdeb8a' },
        { chainId: 42161, address: '0x8de84b429b45dde1d4c6eb8d5c2b7260aef43e7b' },
        { chainId: 42161, address: '0xa130cca536818f891a861b28e5382ee974b20fd4' },
        { chainId: 42161, address: '0xa7a782d16c957b2996f5016f177d0315e73d0ce6' },
        { chainId: 42161, address: '0xb6ee3e154d84c6a3db13dfb3f004ded2fba11e8c' },
        { chainId: 42161, address: '0xb8ca62e2fc67e0add372c65cc3fa50818906a270' },
        { chainId: 42161, address: '0xbe3e716f27892e9d7d6842f21f675c442808bad6' },
        { chainId: 42161, address: '0xbef12c6f84865d7250001b80f533e33cf86bacae' },
        { chainId: 42161, address: '0xc2b4b54c05a4881263c27700fe7d2468444ef498' },
        { chainId: 42161, address: '0xcaa937a4c1d51cbdcf01fdf1d22691a13ce01cec' },
        { chainId: 42161, address: '0xcbda1661fb1bfc38354ad34b39718c2356c3e28d' },
        { chainId: 42161, address: '0xd28a4ca0fdab6fcdb09427e20d8190f86469e89a' },
        { chainId: 42161, address: '0xd98349739e6c1a0166c602dc9d77c0952fb1df64' },
        { chainId: 42161, address: '0xdebe84717d45f6b99b615009548de057a442dd7f' },
        { chainId: 42161, address: '0xdf4c2bb190bff4d8cc34bdaeff24a3bbff1e9abd' },
        { chainId: 42161, address: '0xe22446b390e6788fdcf5f15a1fab1a33ad5318e3' },
        { chainId: 42161, address: '0xe5aee78922f2cf0b666d0b6f29124b23f9aed1c3' },
        { chainId: 42161, address: '0xf5c33b6bc0bf4eb0e099486409af3c9ba58222da' },
        { chainId: 42161, address: '0xfabfea34dbfafd924b59ba2b4d3c4c24bfd64099' },
        { chainId: 43114, address: '0x1b156c5c75e9df4caab2a5cc5999ac58ff4f9090' },
        { chainId: 43114, address: '0x2de6b91e8695054a53aa9d3fcf1e8efb791079c8' },
        { chainId: 43114, address: '0x392629bc3ef46b537f1a33730b28b75d8616176a' },
        { chainId: 43114, address: '0x473dd2fc03343fad45369bed4d56f72fb5c9a130' },
        { chainId: 43114, address: '0x74b3766f6a742bbcc91534354a4cfbf981996b82' },
        { chainId: 43114, address: '0xb82fea26c9eabdbbb03c20d6b86fe027004d4927' },
        { chainId: 43114, address: '0xc3d48ba8d79de6fcfe814b78c5cf4241a74cb02c' },
        { chainId: 43114, address: '0xcdbe1ae1b15776ca7fe982788dc4ea51edb09bf7' },
        { chainId: 534352, address: '0x299ab6eac5042d446aad9b1fd2ce66a8edb9a461' },
        { chainId: 5464, address: '0x879f6c5a0cec83006771b0c271e644b635dc9666' },
        { chainId: 5464, address: '0xb227116fa19abb3a94655ddf24e9cfa09c58d154' },
        { chainId: 5464, address: '0xc30c1f0562207a2b064ee9b3cb284421d55f61ed' },
        { chainId: 5464, address: '0xc46833f6217db6586fd129cc2f61361dfce4c21d' },
        { chainId: 5464, address: '0xd3ea0d80274f0a26b59d9cc4a0876ec70f7ec009' },
        { chainId: 5464, address: '0xe7e6a718218d737945e6f039c161d3c3c550cba8' },
        { chainId: 56, address: '0x12c409605e6cc819395422cf77049b18d76437ad' },
        { chainId: 56, address: '0x19daae2ae9ded737d980e328b509986bce27ad91' },
        { chainId: 56, address: '0x22f4eb9514fd01a7909215656643880a060c4f6f' },
        { chainId: 56, address: '0x2cb78da6342e13f10bd88d5d16cc24a3f499539b' },
        { chainId: 56, address: '0x2fedb6a32d02c7ed7c8596f12f7c7e302e17bfb3' },
        { chainId: 56, address: '0x355ecddb484541796c6cbe4e21dc4994d46c096e' },
        { chainId: 56, address: '0x35a1cb20f7a8c717c83037fb67b733584f05fb17' },
        { chainId: 56, address: '0x4405a1eb4c4be56e34358a8ebd77705f56c56e03' },
        { chainId: 56, address: '0x453d4ba9a2d594314df88564248497f7d74d6b2c' },
        { chainId: 56, address: '0x4f9fa0362985e5b6eace05d1a3b409e9795f5e89' },
        { chainId: 56, address: '0x52bee14ddc0bdd9c97838f28eee10aea2d056cf5' },
        { chainId: 56, address: '0x54e88c45b1766f1c10ab4d3933f6fbf7101d70af' },
        { chainId: 56, address: '0x856d44f47ffd7166d183dc5feeb54ba95fe30cd2' },
        { chainId: 56, address: '0x95435d27ea058abea6edbecb684194595e13d5f3' },
        { chainId: 56, address: '0x97dd7be747e6a2614b742739844e1284986dc779' },
        { chainId: 56, address: '0x989f152b95bfb4ac2318aaf1f10cef8e9f4ef50b' },
        { chainId: 56, address: '0x99857b129d20e1ac3bd75e719d343d496fe207ee' },
        { chainId: 56, address: '0x9ba7aaf19d833237f8db54d313dd02950d969626' },
        { chainId: 56, address: '0xa8054c5af2597f2b83ae91476d13b1aa14a608cd' },
        { chainId: 56, address: '0xcd54d818d3fb15f3919dc384aa3a5e6d914d3996' },
        { chainId: 56, address: '0xd40acf71871d84eb87b13c9639e9fcd28a0630c2' },
        { chainId: 56, address: '0xd5b292e6691618b8c4d8aede8f0fd71ddfa9c05f' },
        { chainId: 56, address: '0xe3fd359efadc90e30d57f2959ad66b51dbbc2bac' },
        { chainId: 56, address: '0xe444df32778bbd2afbe0e81d368421f609733ec4' },
        { chainId: 56, address: '0xe95af6f8d87b937a7cb033542032a888b33063f3' },
        { chainId: 56, address: '0xef2b7166d389b5726de4ca634c9ed1fbd8ccead4' },
        { chainId: 56, address: '0xf0ead8d70f65a162fb88f481c7c306b27309a119' },
        { chainId: 56, address: '0xf5f8289b204bff321fc965ef86c6107d63f2a421' },
        { chainId: 59144, address: '0x51811e1cec1a2fde5a1e5661312cba177fe532d3' },
        { chainId: 59144, address: '0x719b6c7c4c0ad965bc972ccba4a37544a11c766e' },
        { chainId: 59144, address: '0x84edab4008b95d504e3cdc58260395b9d9b9415e' },
        { chainId: 59144, address: '0x90eaf96448e92ced65463decc4e1a99f7796718f' },
        { chainId: 59144, address: '0xbde8cba4971d72b838b43c693bfa0f17058a8263' },
        { chainId: 59144, address: '0xdd43c6e636fac90598dde21e57e8e9cbb1a6d8fd' },
        { chainId: 59144, address: '0xf7029ccdc072230afc8ec3911b99a910bd908919' },
        { chainId: 80094, address: '0x873579e91875934d0b4581fc9daffe3e6e568500' },
        { chainId: 80094, address: '0xde6da031d16a0475564edbd2055965085529cf13' },
        { chainId: 8453, address: '0x0a1bbea11423f0cd2c247a9ad2ae6bd06aebc60d' },
        { chainId: 8453, address: '0x0bd1ecea83b07ec9836f82236567bcbc4f0862f0' },
        { chainId: 8453, address: '0x0d6a63dc3b82792ae127c224217e04f2ac580947' },
        { chainId: 8453, address: '0x0f28ac6a809211828d1e4d3e0d770107b2be66ed' },
        { chainId: 8453, address: '0x11da70a4389d68cdaa5079b1e8fb5f580bccd6be' },
        { chainId: 8453, address: '0x14f610d02da4440a908ddeb7fb0a9a0f0e7ecf0a' },
        { chainId: 8453, address: '0x18b3ff55d5a41f8b4d9610cfc9c839d2e45a4515' },
        { chainId: 8453, address: '0x2141097795bda56cf66637b6030307134f7d4d1f' },
        { chainId: 8453, address: '0x2b8d8cff6d660290e3d98405b1770c8bab9f125c' },
        { chainId: 8453, address: '0x2eacd55c2a2c442d72992dd66fa11b476238cbc0' },
        { chainId: 8453, address: '0x303a1247be1dc6182a3eeff08b340f46f553f414' },
        { chainId: 8453, address: '0x305cc875b66e52ba366b630909490b88ab32f628' },
        { chainId: 8453, address: '0x3173df7ee4f27c8be26193e05b658240d60c7216' },
        { chainId: 8453, address: '0x329adbe706e87a2a1ee4c5caeece716ba4901c05' },
        { chainId: 8453, address: '0x396808b5cb13a7efe2f83b92a2083949789d044a' },
        { chainId: 8453, address: '0x3c5a2e944b97fd55a0bfeeaeefa915571f1dba35' },
        { chainId: 8453, address: '0x3dfa2304ae2ccc680e9344fb03131522307fc2a6' },
        { chainId: 8453, address: '0x3fdacf9c88ba6065004bcac97f3124f1be1959fe' },
        { chainId: 8453, address: '0x42f1a7795083eee1f804dd4d33c5e69a0f32bca4' },
        { chainId: 8453, address: '0x43c4a608f6cfa2348d568f77a14389688788e8ee' },
        { chainId: 8453, address: '0x46d54e9595d61b2f6764c77a1d6448158f4245af' },
        { chainId: 8453, address: '0x49aebb6e20d9ff5b6426ede96fd74712db17f616' },
        { chainId: 8453, address: '0x4ad02bf095b8ffb6e0ac687beee5610ca3ebe6b1' },
        { chainId: 8453, address: '0x4b9de8f9b2b1afd77efca670821d962f2031be26' },
        { chainId: 8453, address: '0x4ff14c8f17b2ad123f04fbe85d764a627dc3223d' },
        { chainId: 8453, address: '0x5031dde162e09e4cf10cd3a5b51781c0e665dd3f' },
        { chainId: 8453, address: '0x52ef6f34433c5bb6fdc0c7954943f6b82eab801f' },
        { chainId: 8453, address: '0x556b04ddbdb678a9f4a6813c15760ab0e9ffe2a3' },
        { chainId: 8453, address: '0x55b61ae86e827075b5301fc4cc42cdbfcc64edef' },
        { chainId: 8453, address: '0x5ab908e4186ef0ab6514c6d618f093d4d557b055' },
        { chainId: 8453, address: '0x5af45b3a8cb44b444ddf9cceb90f5998eac0fc97' },
        { chainId: 8453, address: '0x5b9ab4958823ba8b75b4d398800a97cccb4aa8f2' },
        { chainId: 8453, address: '0x61e3dbabb0493497ba7e6bb5a59d34e79cf4263b' },
        { chainId: 8453, address: '0x62f1d6f43c5ea61d1c9b687c3bc338c94906da52' },
        { chainId: 8453, address: '0x67ba56deccbe2ccdb54254c8a13df1e9a42f6b09' },
        { chainId: 8453, address: '0x6e662b6e438858a3ee6c31b651c1efd3360ae348' },
        { chainId: 8453, address: '0x8498b9268ccf4dc012301f53fd4da2fd4083e4c2' },
        { chainId: 8453, address: '0x87898dea43bfa4e99208f9eb0e1b1ee65a2f8582' },
        { chainId: 8453, address: '0x8b17e3f830d4c5c7cb06a4092126e8ce3026d548' },
        { chainId: 8453, address: '0x8ca034a6a1662e207514fd17c1c69ee317b2c58b' },
        { chainId: 8453, address: '0x8f7f80965d76797db30963c274fcf9cd06887786' },
        { chainId: 8453, address: '0x92253f6e64803fb838b0e9959d9da1b9c5c0e944' },
        { chainId: 8453, address: '0xa0f499e75972ad7c72c31b150c18a0e8a75eaa1b' },
        { chainId: 8453, address: '0xa394dd3efab3db849ef3fb81b4227eb606fc9d65' },
        { chainId: 8453, address: '0xa4dfe9c844d01c5f5c0ebd7d066f79b34032761e' },
        { chainId: 8453, address: '0xa725c4f6f7dca3148d372dea1d0e92945256de2e' },
        { chainId: 8453, address: '0xa8492c7112e86244317e666b3a856713dff1226a' },
        { chainId: 8453, address: '0xa95c5a92f50d13225f93186889d3eece0ee5dc77' },
        { chainId: 8453, address: '0xae2543996517e7a010ffd387af18a362f79b9106' },
        { chainId: 8453, address: '0xb60394ce63c2180c08e1910bfc588b0156d18149' },
        { chainId: 8453, address: '0xb6f855e6457b7966d7b2faf013db6702dceaae81' },
        { chainId: 8453, address: '0xbecad6b8582dc87a5607e9e0d4f11060c3d660bd' },
        { chainId: 8453, address: '0xc3e8298bdfa003a6edda09cfce8706902dc7d0a2' },
        { chainId: 8453, address: '0xc4cd7adcaba92db1c27843d971b540943ef1ea31' },
        { chainId: 8453, address: '0xc55e93c62874d8100dbd2dfe307edc1036ad5434' },
        { chainId: 8453, address: '0xc60e5e5b65b5fba8b099e21d8658b8377bf34321' },
        { chainId: 8453, address: '0xc7e6c6c57c956b0a3e15b88aaf9dbae5b82e2b65' },
        { chainId: 8453, address: '0xc8616746c44bfddc121887049eed96637c5ba971' },
        { chainId: 8453, address: '0xd209283562f1874f02ace3abb31e977af0ea7840' },
        { chainId: 8453, address: '0xd6881c98e6be699d972ae8c74a5b8748073e6e96' },
        { chainId: 8453, address: '0xdaa86c56c8febc471a4674a8ff59e23f73dae317' },
        { chainId: 8453, address: '0xdd8800d70cf9edc73f9d73852db08121237ebe6a' },
        { chainId: 8453, address: '0xe255486bc7128dad3e8be4abc208410e0393bff6' },
        { chainId: 8453, address: '0xe7da4149b5c873d4ca2ea22ef307d13ed7c11da7' },
        { chainId: 8453, address: '0xebe5b28ddf72ee445081a2b7a0d3eb7c9a8eea0c' },
        { chainId: 8453, address: '0xf02d12b4e419c4c4a329e9ab49ec8a89e065f95e' },
        { chainId: 8453, address: '0xf42b6993304425b3d5adf57b2dcf4a51364b6697' },
        { chainId: 8453, address: '0xf4ebfc69e36904b482aebcc6ca6362e92f5b176a' },
        { chainId: 8453, address: '0xf6f0ab0f7ade218ad1a1eb1e5602a1c5fa2ebdd3' },
        { chainId: 8453, address: '0xf765c6d26b0b493c2e44075c0e722c3be5a40dad' },
        { chainId: 8453, address: '0xfb195045365620266ba8c300f42cf69720d2d016' },
        { chainId: 8453, address: '0xfc2f20a29697c400577b944c648378cf61cc3748' },
        { chainId: 8453, address: '0xfe3528cd1fe76745886efd655e5ab54859043df1' },
        { chainId: 8453, address: '0xfeb6d8c8571d64b7aa2c4d9b720750b0256d34fe' },
        { chainId: 999, address: '0x795436fb1ebafb210e4e2976dbdf49df30b0a4d4' },
        { chainId: 999, address: '0xb400ea86eb0ded6d313b89ee579fd76cb730922a' },
        { chainId: 999, address: '0xcca0a5e330d7640d2599b4f0ac6067d658d46688' },
        { chainId: 999, address: '0xd9bcdf03d03d1f36d2b6daf6b30b9ee6c014f610' },
    ];

const vaultBlacklist = R.pipe(
    rawVaultBlacklist,
    // ensure lowercase addresses
    R.map((entry) => ({ ...entry, address: entry.address.toLowerCase() as Hex })),
    // O(1) lookup
    // { [chainId]: { [address]: true } }
    R.groupBy((entry) => entry.chainId),
    R.mapValues((addresses) =>
        R.pipe(
            addresses,
            R.indexBy(({ address }) => address),
            R.mapValues(() => true)
        )
    )
);

export function isVaultBlacklisted(chainId: ChainId, address: string) {
    if (!(chainId in vaultBlacklist)) {
        return false;
    }
    return vaultBlacklist[chainId as keyof typeof vaultBlacklist]?.[address.toLowerCase() as Hex] ?? false;
}

const allAccountBlacklist = R.pipe(
    // raw account blacklist
    [
        { chainId: 10, address: '0x9b50b06b81f033ca86d70f0a44f30bd7e0155737' },
        { chainId: 137, address: '0x540a9f99bb730631bf243a34b19fd00ba8cf315c' },
        { chainId: 137, address: '0xf039fe26456901f863c873556f40fb207c6c9c18' },
        { chainId: 43114, address: '0x6674f3961C5908B086A5551377806f4BA8F0Ac99' },
        { chainId: 43114, address: '0x7f62af30081178f502c3d4da17825e58d240d737' },
        { chainId: 56, address: '0x03c509fd85d51dc7e75fa2de06276cfa147486ea' },
        { chainId: 56, address: '0x31fe02b9ea5501bfe8a872e205dfe6b6a79435ed' },
        { chainId: 56, address: '0xac18fcb470f913b94946bee43dc52e197d765791' },
        { chainId: 8453, address: '0x6f19da51d488926c007b9ebaa5968291a2ec6a63' },
    ],
    // ignore addresses from address book to all chains
    R.concat(
        R.pipe(
            addressBookByChainId,
            R.entries(),
            R.flatMap(([chainId, cfg]) =>
                R.pipe(
                    [
                        cfg.platforms.beefyfinance.beefySwapper,
                        cfg.platforms.beefyfinance.zap,
                        cfg.platforms.beefyfinance.zapTokenManager,
                    ],
                    R.filter((address) => address !== undefined),
                    R.map((address) => ({ chainId, address }))
                )
            )
        )
    ),
    // add config addresses to all chains (concatenate arrays)
    R.concat(
        R.pipe(
            allChainIds,
            R.flatMap((chainId) =>
                R.pipe(
                    [config.ADDRESS_ZERO, config.BURN_ADDRESS, config.MINT_ADDRESS],
                    R.map((address) => ({ chainId, address }))
                )
            )
        )
    ),

    // ensure lowercase addresses
    R.map((entry) => ({ ...entry, address: entry.address.toLowerCase() as Hex })),
    // O(1) lookup
    // { [chainId]: { [address]: true } }
    R.groupBy((entry) => entry.chainId),
    R.mapValues((addresses) =>
        R.pipe(
            addresses,
            R.indexBy(({ address }) => address),
            R.mapValues(() => true)
        )
    )
);

export async function isAccountBlacklisted(context: HandlerContext, chainId: ChainId, address: string) {
    const lowerAddress = address.toLowerCase() as Hex;
    if (allAccountBlacklist[chainId][lowerAddress]) {
        return true;
    }
    // don't track balances for indexed entities that are known to handle some share tokens
    // we'll track that separately as proper vault breakdown
    const [erc4626Adapter, rewardPool, classicBoost, classicVaultStrategy] = await Promise.all([
        isErc4626Adapter(context, chainId, lowerAddress),
        isRewardPool(context, chainId, lowerAddress),
        isClassicBoost(context, chainId, lowerAddress),
        isClassicVaultStrategy(context, chainId, lowerAddress),
    ]);
    if (erc4626Adapter || rewardPool || classicBoost || classicVaultStrategy) {
        return true;
    }
    return false;
}

export const blacklistStatus = S.union([
    // all is green
    'ok',
    // definitly malformed contract
    'blacklisted',
    // we won't be able to index it for now
    // but that does not mean it's malformed
    // maybe it can be indexed later when rpc is available
    // but can also be a bug in the indexer
    // but can also be a bug in the contract
    'maybe_blacklisted',
]);
export type BlacklistStatus = S.Output<typeof blacklistStatus>;

// have a common log function for blacklist status
// that makes it easy to grep all blacklist logs and inspect them:
// tail -f ./generated/hyperindex.log | rg -i 'BLACKLIST' | jq '{chainId, contractAddress}'
export const logBlacklistStatus = (
    log: Logger,
    status: BlacklistStatus,
    type: string,
    data: Record<string, unknown> & { contractAddress: string }
) => {
    log.error(`[BLACKLIST] ${type}`, { status, ...data, contractAddress: data.contractAddress });
};
