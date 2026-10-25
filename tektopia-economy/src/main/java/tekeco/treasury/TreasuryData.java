package tekeco.treasury;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import net.minecraft.nbt.NBTTagCompound;
import net.minecraft.nbt.NBTTagList;
import net.minecraft.world.World;
import net.minecraft.world.storage.MapStorage;
import net.minecraft.world.storage.WorldSavedData;
import net.minecraftforge.common.util.Constants;

/**
 * Every village's treasury in one dimension, keyed by TekTopia's village UUID.
 * Kept in per-world storage, like TekTopia's own VillageManager.
 */
public class TreasuryData extends WorldSavedData {
    public static final String NAME = "tekeco_treasury";

    private final Map<UUID, Treasury> treasuries = new HashMap<>();

    public TreasuryData() {
        this(NAME);
    }

    public TreasuryData(String name) {
        super(name);
    }

    public static TreasuryData get(World world) {
        MapStorage storage = world.getPerWorldStorage();
        TreasuryData data = (TreasuryData) storage.getOrLoadData(TreasuryData.class, NAME);
        if (data == null) {
            data = new TreasuryData();
            storage.setData(NAME, data);
        }
        return data;
    }

    public Treasury forVillage(UUID villageId) {
        return treasuries.computeIfAbsent(villageId, id -> new Treasury());
    }

    @Override
    public void readFromNBT(NBTTagCompound nbt) {
        treasuries.clear();
        NBTTagList list = nbt.getTagList("treasuries", Constants.NBT.TAG_COMPOUND);
        for (int i = 0; i < list.tagCount(); i++) {
            NBTTagCompound tag = list.getCompoundTagAt(i);
            Treasury treasury = new Treasury();
            treasury.readFromNBT(tag);
            treasuries.put(tag.getUniqueId("village"), treasury);
        }
    }

    @Override
    public NBTTagCompound writeToNBT(NBTTagCompound compound) {
        NBTTagList list = new NBTTagList();
        for (Map.Entry<UUID, Treasury> entry : treasuries.entrySet()) {
            NBTTagCompound tag = new NBTTagCompound();
            tag.setUniqueId("village", entry.getKey());
            entry.getValue().writeToNBT(tag);
            list.appendTag(tag);
        }
        compound.setTag("treasuries", list);
        return compound;
    }
}
