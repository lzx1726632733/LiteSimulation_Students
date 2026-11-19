<!-- 顶部控件菜单栏 -->
<template>
    <div class="top-toolbar">
        <div v-for="item in topToolBarMenus" :key="item.id">
            <button class="btn" @click="handleClickControl(item)">
                <img class="btn-img" :src="item.icon" :alt="item.name" />
                <span class="btn-text">{{ item.name }}</span>
            </button>
        </div>
    </div>
</template>

<script setup>
import {ref} from "vue";
import {topToolBarMenus} from "@/config/topToolBarMenuData";

//控件点击事件
const handleClickControl = (item) => {

};

</script>

<style scoped>
.top-toolbar {
    display: flex;
    flex-direction: row;
    height: 40px;
    width: 100%;
    background-color: #ffffff;
    align-items: center;
    margin-left: 10px;
    user-select: none;
}

.btn {
    display: flex;
    border-radius: 8px;
    border: none;
    background-color: #fefefe;
    align-items: center;
    padding: 4px 6px;
    margin-right: 6px;
    user-select: none;
    cursor: pointer;
}

.btn-img {
    width: 20px;
    height: 20px;
    margin-right: 4px;
    user-select: none;
    -webkit-user-drag: none;
}

.btn-text {
    font-size: 14px;
    font-weight: 400;
    color: #5A5A5A;
    user-select: none;
    -webkit-user-drag: none;
}

.btn:hover {
    background-color: #2566fd;
}

.btn:hover .btn-img {
    filter: brightness(0) saturate(100%) invert(100%);
}

.btn:hover .btn-text {
    color: #ffffff;
}

.btn-img.start {
    height: 20px;
    width: 20px;
}
</style>
