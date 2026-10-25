package tekeco.payroll;

import java.util.UUID;
import javax.annotation.Nullable;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;
import net.tangotek.tektopia.Village;
import net.tangotek.tektopia.VillageManager;
import net.tangotek.tektopia.structures.VillageStructureType;
import tekeco.treasury.Treasury;
import tekeco.treasury.TreasuryData;

/** Looks up TekTopia villages and their treasuries. */
public final class Villages {
    private Villages() {
    }

    /**
     * The village's stable id, or null if it has no Town Hall. Without a Town Hall,
     * TekTopia hands out a shared placeholder whose id changes every restart.
     */
    @Nullable
    public static UUID id(@Nullable Village village) {
        if (village == null || !village.hasStructure(VillageStructureType.TOWNHALL)) {
            return null;
        }
        return village.getTownData().getUUID();
    }

    @Nullable
    public static Village at(World world, BlockPos pos) {
        return VillageManager.get(world).getVillageAt(pos);
    }

    @Nullable
    public static Treasury treasury(World world, @Nullable Village village) {
        UUID id = id(village);
        return id == null ? null : TreasuryData.get(world).forVillage(id);
    }
}
